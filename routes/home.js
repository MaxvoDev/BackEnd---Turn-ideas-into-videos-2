const express = require("express");
const router = express.Router();
require('dotenv').config();
const request = require('request-promise');
const fs = require('fs');
const ffmpegPath = require('@ffmpeg-installer/ffmpeg').path;
const ffmpeg = require('fluent-ffmpeg');
ffmpeg.setFfmpegPath(ffmpegPath);
const { OpenAI } = require('openai');
const http = require('http');
const { createApi } = require('unsplash-js');
const { put, list } = require("@vercel/blob");
const stream = require('stream');
const path = require('path');


const unsplash = createApi({ accessKey: 'axgDaWdQxno1ImdajxDnpJAp-QYGkoVOGuwJyOH1SuU' });


const tempPath = '/tmp/';
const finalVideoPath = path.join(tempPath, 'final.mp4');
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const API_ENDPOINT = 'https://audio.api.speechify.com/generateAudioFiles';
const payload = {
    audioFormat: "mp3",
    paragraphChunks: ["Script HERE"],
    voiceParams: {
        "name": "PVL:3371c48a-a894-47f3-8100-b3028f1fcf4b", "engine": "speechify",
        "languageCode": "en-US"
    }
};

const generateSingleVideo = function (tag, audioData, imageData) {
    return new Promise(async (resolve, reject) => {
        let outputFilePath = path.join(tempPath, `temp${tag}.mp4`);
        let imageFile = path.join(tempPath, `image${tag}.png`);
        let audioFile = path.join(tempPath, `audio${tag}.mp3`);

        fs.writeFileSync(audioFile, audioData);
        fs.writeFileSync(imageFile, imageData);

        // Create a new FFmpeg command
        const command = ffmpeg();
        command.input(imageFile);
        command.input(audioFile);


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
            .output(outputFilePath);

        // Run the FFmpeg command
        command
            .on('end', async () => {
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

router.get('/final-video', async(req, res) => {
    const stat = fs.statSync(finalVideoPath);
    const fileSize = stat.size;
    const head = {
      'Content-Length': fileSize,
      'Content-Type': 'video/mp4',
    };
    res.writeHead(200, head);
    fs.createReadStream(finalVideoPath).pipe(res);
})

router.post('/merge-video', async (req, res) => {
    const videoLength = req.body.videoLen;

    // Create a new FFmpeg command
    const command = ffmpeg();

    const inputFiles = [];
    for (let i = 0; i < videoLength; i++) {
        let inputFile = path.join(tempPath, `temp${i}.mp4`);
        inputFiles.push(inputFile);
        command.input(inputFile);
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
        .on('end', () => {
            console.log('Video merging finished.');
            res.json({ success: true });
        })
        .on('error', (err) => {
            console.error('Error:', err);
        });

    // Run the FFmpeg command to merge the videos
    command.run();

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
        console.log("Chat completion:", result);
        res.json(JSON.parse(result));
    } else {
        console.log("No completion found in the response");
        res.json(null);
    }
});


router.post('/script-to-video', async (req, res) => {
    const videoIndex = req.body.videoData;
    const videoData = req.body.videoData;
    scriptToVideo(videoData)
        .then(resp => {
            if (!resp)
                res.json({ success: false });
            else {
                http.createServer(function (req, res) {
                    // Set the correct headers for video streaming
                    res.writeHead(200, { 'Content-Type': 'video/mp4' });
                    // Create a stream for the video file and pipe it to the response
                    const stream = fs.createReadStream(finalVideoPath);
                    stream.pipe(res);
                }).listen(8000);

                res.json({ success: true });
            }
        })
})

router.get('/test', async (req, res) => {
    const tag = 0;
    let outputFilePath = `${tempPath}temp${tag}.mp4`;
    const imageFile = `${tempPath}image${tag}.png`;
    const audioFile = `${tempPath}audio${tag}.mp3`;

    const audioUrl = 'https://res.cloudinary.com/dkx4jbkdu/video/upload/v1707031930/wyj93c0a8hzl5xf71nfr.mp3';
    const imageUrl = 'https://res.cloudinary.com/dkx4jbkdu/image/upload/v1707031932/f5ddgdumltflklydid93.jpg';

    // Create a new FFmpeg command
    const command = ffmpeg();
    command.input(imageUrl);
    command.inputFormat('image2');
    command.input(audioUrl);
    command.inputFormat('mp3')

    const tempOutputPath = path.join('/tmp/', 'test.mp4'); // Temporary file

    const passThrough = new stream.PassThrough();

    // Specify output options
    command
        .fps(30)
        .addOptions([
            '-pix_fmt yuv420p',
            // '-vf scale=1920:1080,setsar=1',
            '-vf scale=1024:1024,setsar=1',
            '-c:v libx264',
            '-c:a aac',
            '-strict experimental',
            '-ar 44100',
            '-r 30',
            '-crf 23',
            '-tune stillimage',
        ])
        .output(tempOutputPath)

    // Run the FFmpeg command
    command
        .on('end', async () => {
            console.log('Done');

            fs.stat(tempOutputPath, (err, stat) => {
                const head = {
                    'Content-Length': stat.size,
                    'Content-Type': 'video/mp4',
                };
                res.writeHead(200, head);
                fs.createReadStream(tempOutputPath).pipe(res);
            });
        })
        .on('error', (err) => {
            console.error('Error:', err);
        })
        .on('progress', (progress) => {
            // You can also listen for progress events to get information on the compilation progress
            console.log('Processing: ' + progress.percent + '% done');
        })
        .run();

});


module.exports = router;
