require('dotenv').config();

const path = require('path');
const express = require("express");
const router = express.Router();
const request = require('request-promise');
const fs = require('fs');
const { OpenAI } = require('openai');
const { createApi } = require('unsplash-js');
const ffmpeg = require('fluent-ffmpeg');

const unsplash = createApi({ accessKey: process.env.UNSPLASH_ACCESS_KEY });

const tempPath = '/tmp/';
const finalVideoPath = path.join(tempPath, 'final.mp4');
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

const API_ENDPOINT = 'https://audio.api.speechify.com/generateAudioFiles';

const voiceList = JSON.parse(process.env.SPEECHIFY_VOICE_PARAMS);
const payload = {
    audioFormat: "mp3",
    paragraphChunks: ["Script HERE"],
    voiceParams: voiceList['mrbeast']
};


const generateSingleVideo = function (tag, audioData, imageData) {
    return new Promise(async (resolve, reject) => {
        let outputFilePath = path.join(tempPath, `temp${tag}.mp4`);
        let imageFile = path.join(tempPath, `image${tag}.png`);
        let audioFile = path.join(tempPath, `audio${tag}.mp3`);

        fs.writeFileSync(imageFile, imageData);
        fs.writeFileSync(audioFile, audioData);

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

function mergeVideo(videoLength) {
    return new Promise((resolve, reject) => {
        const command = ffmpeg();
        const inputFiles = [];
        for (let i = 0; i < videoLength; i++) {
            inputFiles.push(`/tmp/temp${i}.mp4`);
            command.input(`/tmp/temp${i}.mp4`);
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
                const videoData = fs.readFileSync(finalVideoPath);
                const videoBase64 = videoData.toString('base64');

                console.log('Video merging finished.');
                resolve(videoBase64);
            })
            .on('error', (err) => {
                console.error('Error:', err);
                reject(err);
            });

        // Run the FFmpeg command to merge the videos
        command.run();
    })
}
router.post('/merge-video', async (req, res) => {
    const videoLength = req.body.videoLength;
    mergeVideo(videoLength)
        .then(resp => {
            res.json({
                status: "success",
                data: resp
            })
        })
        .catch(err => {
            res.json({
                status: "error",
                data: ''
            })
        });
})

router.post('/generate-video', async (req, res) => {
    const videoData = req.body.videoData;
    const voiceService = req.body.videoSettings.voiceService;

    const promises = [];
    for (let i = 0; i < videoData.length; i++) {
        const videoTag = i;
        const getPhoto = unsplash.search.getPhotos({
            query: videoData[i].imageDesc,
            page: 1,
            perPage: 1
        })
            .then(resp => {
                return request.get({ url: `${resp.response.results[0].urls.raw}&w=1280&h=720&fit=crop`, encoding: null });
            })

        const audioScript = videoData[i].script;
        payload.paragraphChunks = [audioScript];
        payload.voiceParams = voiceList[voiceService];
        let getAudio = request.post(API_ENDPOINT, { json: payload });

        const videoPromise = Promise.all([getPhoto, getAudio])
            .then((resp) => {
                const imageData = resp[0];
                const audioData = Buffer.from(resp[1].audioStream, 'base64');
                return generateSingleVideo(videoTag, audioData, imageData)
            })
        promises.push(videoPromise);
    }

    Promise.all(promises)
        .then(resp => {
            res.json({
                status: "success",
                data: ''
            })
        })
        .catch(err => {
            res.json({
                status: "error",
                data: ''
            })
        })
})

router.get('/generate-script', async (req, res) => {
    const videoLength = req.query.videoLength;
    const idea = req.query.idea;

    const response = await openai.chat.completions.create({
        model: "gpt-3.5-turbo-16k",
        messages: [
            {
                "role": "user",
                "content": `GENERATE FOR ME A VIRAL VIDEO SCRIPT TO TALK FOR A VIDEO LESS THAN ${videoLength} SECONDS. Each script should be short and can read in less than 15 seconds.

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
