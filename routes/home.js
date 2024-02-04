require('dotenv').config();
const express = require("express");
const router = express.Router();
const request = require('request-promise');
const fs = require('fs');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);
const { OpenAI } = require('openai');
const { createApi } = require('unsplash-js');
const path = require('path');
const cloudinary = require('cloudinary').v2;

cloudinary.config(JSON.parse(process.env.CLOUDINARY_CONFIG));

const unsplash = createApi({ accessKey: process.env.UNSPLASH_ACCESS_KEY });

const tempPath = '/tmp/';
const finalVideoPath = path.join(tempPath, 'final.mp4');
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const API_ENDPOINT = 'https://audio.api.speechify.com/generateAudioFiles';
const payload = {
    audioFormat: "mp3",
    paragraphChunks: ["Script HERE"],
    voiceParams: JSON.parse(process.env.SPEECHIFY_VOICE_PARAMS)
};

const uploadToCloudinary = async (filePath, fileBuffer, fileType, isImage = true) => {
    return new Promise((resolve, reject) => {
        const base64Data = fileBuffer.toString('base64');
        const dataURI = `data:${fileType};base64,${base64Data}`;
        const uploadConfig = {
            resource_type: 'image',
            public_id: filePath,
            folder: "idea2video",
            overwrite: true,
        };

        if (!isImage)
            uploadConfig.resource_type = 'video';

        cloudinary.uploader.upload(
            dataURI,
            uploadConfig,
            function (error, result) {
                if (error)
                    console.error('Upload Error:', error);
                else
                    resolve(result.url);
            }
        );
    })
}
const generateSingleVideo = function (tag, audioData, imageData) {
    return new Promise(async (resolve, reject) => {
        let outputFilePath = `temp${tag}.mp4`;
        let imageFile = `image${tag}.png`;
        let audioFile = `audio${tag}.mp3`;

        const imageUrl = await uploadToCloudinary(imageFile, imageData, 'image/png');
        const audioUrl = await uploadToCloudinary(audioFile, audioData, 'audio/mp3', false);

        const command = ffmpeg();
        command.input(imageUrl);
        command.inputFormat('image2');
        command.input(audioUrl);
        command.inputFormat('mp3')


        // Specify output options
        command
            .fps(30)
            .addOptions([
                '-pix_fmt yuv420p',
                // '-vf scale=1920:1080,setsar=1',
                '-vf scale=1280:720,setsar=1',
                '-c:v libx264',
                '-c:a aac',
                '-strict experimental',
                '-ar 44100',
                '-r 30',
                '-crf 23',
                '-tune stillimage',
            ])
            .output(`/tmp/${outputFilePath}`)
            .outputFormat('mp4');

        // Run the FFmpeg command
        command
            .on('end', async () => {

                const videoData = fs.readFileSync(`/tmp/${outputFilePath}`);
                await uploadToCloudinary(outputFilePath, videoData, 'video/mp4', false);
                resolve(true);
            })
            .on('error', (err) => {
                console.error('Error:', err);
            })
            .on('progress', (progress) => {
                // You can also listen for progress events to get information on the compilation progress
                console.log('Processing: ' + progress.percent + '% done');
            })
            .run();
    })
}

const fetchVideoDetails = (publicIds) => {
    return new Promise((resolve, reject) => {
        cloudinary.api.resources({
            resource_type: 'video',
            type: 'upload',
            max_results: 30,
            prefix: 'idea2video/' // Make sure this matches the path to your videos
        }, (error, result) => {
            if (error) {
                console.error('Error listing videos:', error);
                reject(error);
            } else {
                // Filter for specific files based on the list of publicIds
                const specificFiles = result.resources.filter(resource =>
                    publicIds.some(publicId => resource.public_id.endsWith(`idea2video/${publicId}`))
                );

                // Extract URLs of the specific files
                const urls = specificFiles.map(file => file.secure_url); // or use file.url for non-SSL
                resolve(urls);
            }
        });
    });
};

const { Readable } = require('stream');

function bufferToStream(buffer) {
  const stream = new Readable();
  stream.push(buffer); // Push your data onto the stream
  stream.push(null); // Signifies the end of the stream (EOF)
  return stream;
}

async function updateTaskStatusOnCloudinary(taskID, videoData) {
    // Prepare the status content
    const statusContent = videoData;
    const buffer = Buffer.from(statusContent);
    const stream = bufferToStream(buffer);
    // Upload the file to Cloudinary
    try {
        const uploadStream = cloudinary.uploader.upload_stream({
            public_id: `task-${taskID}.txt`,
            folder: "idea2video",
            resource_type: 'raw', // Specify 'raw' for non-image files
            overwrite: true
        });
        stream.pipe(uploadStream);

        console.log(`Task status updated: ${taskID} - ${status}`);
    } catch (error) {
        console.error('Failed to update task status on Cloudinary', error);
    }

}

const taskStatusStore = {};

function getTaskStatusUrl(taskID) {
    return cloudinary.url(`idea2video/task-${taskID}.txt`, {
        resource_type: 'raw',
        secure: true // Use HTTPS
    });
}

router.get('/check-video-status', async (req, res) => {
    try{
        const task = getTaskStatusUrl(112);
        const resp = await request.get(task);
        res.json({
            status: "complete",
            data: resp
        });
    }
    catch(e){
        res.json({status: "processing"});
    }
})

async function ProcessVideoInBackground(videoLength, taskID) {
    // Create a new FFmpeg command
    const command = ffmpeg();
    const filterVideoFiles = [];
    const inputFiles = [];
    for (let i = 0; i < videoLength; i++) {
        filterVideoFiles.push(`temp${i}.mp4`);
    }
    const videoUrls = await fetchVideoDetails(filterVideoFiles);

    for (let i = 0; i < videoUrls.length; i++) {
        inputFiles.push(videoUrls[i]);
        command.input(videoUrls[i]);
    }

    // Specify output options for the merged video
    command
        .addOptions([
            '-filter_complex', `concat=n=${inputFiles.length}:v=1:a=1[outv][outa]`,
            '-map', '[outv]',
            '-map', '[outa]',
            '-c:v libx264',
            '-c:a aac',
            '-strict experimental',
            '-ar 44100',
            '-r 30',
            '-crf 23',
        ])
        .output(finalVideoPath)
        .on('end', async () => {
            const videoData = fs.readFileSync(`/tmp/final.mp4`);
            const videoBase64 = videoData.toString('base64');
            await uploadToCloudinary('final.mp4', videoData, 'video/mp4', false);
            await updateTaskStatusOnCloudinary(taskID, videoBase64);

            console.log('Video merging finished.');

        })
        .on('error', (err) => {
            console.error('Error:', err);
        });

    // Run the FFmpeg command to merge the videos
    command.run();
}

router.post('/merge-video', async (req, res) => {
    // let outputFilePath = path.join(tempPath, `temp${tag}.mp4`);
    taskStatusStore[112] = { status: 'processing' };
    const videoLength = req.body.videoLen;
    ProcessVideoInBackground(videoLength, 112)
    res.json({
        success: true,
        taskID: 112
    });
})

router.post('/generate-video', async (req, res) => {
    const videoData = req.body.videoData;
    const videoTag = videoData.tag;
    const getPhoto = unsplash.search.getPhotos({
        query: videoData.imageDesc,
        page: 1,
        perPage: 1
    })
        .then(resp => {
            return request.get({ url: `${resp.response.results[0].urls.raw}&w=1280&h=720&fit=crop`, encoding: null });
        })

    const audioScript = videoData.script;
    payload.paragraphChunks = [audioScript];
    let getAudio = request.post(API_ENDPOINT, { json: payload });

    Promise.all([getPhoto, getAudio])
        .then(async (resp) => {
            const imageData = resp[0];
            const audioData = Buffer.from(resp[1].audioStream, 'base64');
            await generateSingleVideo(videoTag, audioData, imageData)

            res.json({
                status: "success",
            })
        })
})

router.get('/generate-script', async (req, res) => {
    const idea = req.query.idea;

    const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo-16k",
        messages: [
            {
                "role": "user",
                "content": `GENERATE FOR ME A VIRAL VIDEO SCRIPT TO TALK FOR A VIDEO LESS THAN 20 SECONDS. Each script should be short and can read in less than 10 seconds.

        Make sure the script is meaningful and it will be like a good story
        
        Format as JSON ARRAY below
        [{
          script: "script 1",
          imageDesc: "describe image for script 1"
        },
        etc...
      ] 
        
        Topic idea is: ${idea}  `
            }
        ],
        temperature: 1,
        max_tokens: 3072,
        top_p: 1,
        frequency_penalty: 0,
        presence_penalty: 0,
    });

    if (response.choices && response.choices.length > 0) {
        // Assuming you want the first completion
        const result = response.choices[0].message.content;
        res.json(JSON.parse(result));
    } else {
        console.log("No completion found in the response");
        res.json(null);
    }
});

module.exports = router;
