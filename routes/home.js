const express = require("express");
const router = express.Router();
require('dotenv').config();
const request = require('request-promise');
const fs = require('fs');
const ffmpeg = require('fluent-ffmpeg');
const { OpenAI } = require('openai');
const http = require('http');

const tempPath = '/tmp/';
const finalVideoPath = '/tmp/final.mp4';
const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

router.get("/test", async (req, res, next) => {
  return res.status(200).json({
    title: "Express Testing",
    message: "The app is working properly!",
  });
});

router.get('/generate-script', async (req, res) => {
  const idea = req.query.idea;
  console.log(1);
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
        
        Topic idea is: How Elon Musk Buy Twitter  `
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


module.exports = router;
