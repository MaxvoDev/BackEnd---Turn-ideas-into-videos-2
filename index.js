// Import packages
const express = require("express");
const home = require("./routes/home");
var bodyParser = require('body-parser')
const cors = require('cors');

// Middlewares
const app = express();
app.use(express.json());
app.use(cors());
app.use(bodyParser.json({limit: '1000mb', extended: true}))
app.use(bodyParser.urlencoded({limit: '1000mb', extended: true}))
app.use("/api", home);

const port = process.env.PORT || 9001;
app.listen(port, () => console.log(`Listening to port ${port}`));

module.exports = app;