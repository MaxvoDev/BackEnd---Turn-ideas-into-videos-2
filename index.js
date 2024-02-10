// Import packages
const express = require("express");
const home = require("./routes/home");
var bodyParser = require('body-parser')
const cors = require('cors');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');

// Middlewares
const app = express();
app.use(express.json());
app.use(cors());
app.use(bodyParser.json({limit: '1000mb', extended: true}))
app.use(bodyParser.urlencoded({limit: '1000mb', extended: true}))
app.use("/api", home);

let ffmpegPath = path.join(__dirname, '..', 'ffmpeg');
if(process.env.NODE_ENV === 'dev'){
    const port = process.env.PORT || 9001;
    app.listen(port, () => console.log(`Listening to port ${port}`));

    ffmpegPath = path.join(__dirname, '.', 'ffmpeg.exe');
}
ffmpeg.setFfmpegPath(ffmpegPath);

module.exports = app;