const express = require("express");
const config = require("config");
const shell = require("shelljs");
const fs = require("fs");
const path = require("path");
// const Keycloak = require("keycloak-connect");
// const session = require("express-session");
// const { v4: uuidv4 } = require("uuid");
const dicomParser = require("dicom-parser");
const crypto = require("crypto");
const utils = require("./utils.js");

const app = express();
const logger = utils.getLogger();

// unprotected middleware passing
let middle = function middle(req, res, next) {
  next();
};
/*
// init auth if enabled
if (config.get("useKeycloakAuth")) {
  const memoryStore = new session.MemoryStore();
  const keycloak = new Keycloak({ store: memoryStore });

  // session
  app.use(
    session({
      secret: uuidv4(),
      resave: false,
      saveUninitialized: true,
      store: memoryStore,
    })
  );

  app.use(keycloak.middleware({}));

  // use keycloak as middleware
  middle = keycloak.protect();
}
*/

shell.mkdir("-p", config.get("logDir"));
shell.mkdir("-p", "./data");

app.use(express.static("public"));

// prevents nodejs from exiting
process.on("uncaughtException", err => {
  logger.info("uncaught exception received:");
  logger.info("------------------------------------------")
  logger.error(err.stack);
  logger.info("------------------------------------------")
});

//------------------------------------------------------------------

app.get("/viewer/rs/studies", middle, async (req, res) => {
  // fix for OHIF viewer assuming a lot of tags
  const tags = [
    "00080005",
    "00080020",
    "00080030",
    "00080050",
    "00080054",
    "00080056",
    "00080061",
    "00080090",
    "00081190",
    "00100010",
    "00100020",
    "00100030",
    "00100040",
    "0020000D",
    "00200010",
    "00201206",
    "00201208",
  ];

  const json = await utils.doFind("STUDY", req.query, tags);
  res.json(json);
});

//------------------------------------------------------------------

app.get(
  "/viewer/rs/studies/:studyInstanceUid/series",
  middle,
  async (req, res) => {
    // fix for OHIF viewer assuming a lot of tags
    const tags = [
      "00080005",
      "00080054",
      "00080056",
      "00080060",
      "0008103E",
      "00081190",
      "0020000E",
      "00200011",
      "00201209",
    ];

    const { query } = req;
    query.StudyInstanceUID = req.params.studyInstanceUid;

    const json = await utils.doFind("SERIES", query, tags);
    res.json(json);
  }
);

//------------------------------------------------------------------

app.get(
  "/viewer/rs/studies/:studyInstanceUid/series/:seriesInstanceUid/metadata",
  middle,
  async (req, res) => {
    const { studyInstanceUid, seriesInstanceUid } = req.params;

    // fix for OHIF viewer assuming a lot of tags
    const tags = ["00080016", "00080018"];

    const { query } = req;
    query.StudyInstanceUID = req.params.studyInstanceUid;
    query.SeriesInstanceUID = req.params.seriesInstanceUid;

    const json = await utils.doFind("IMAGE", query, tags);
    // fetch series but wait for first image only
    const waitPromise = await utils.waitOrFetchData(
      studyInstanceUid,
      seriesInstanceUid,
      true
    );
    if (json.length === 0) {
      logger.error("no metadata found");
      res.statusCode = 500;
      res.json(json);
      return;
    }

    const sopInstanceUid = json[0]["00080018"]["Value"][0];
    const storagePath = config.get("storagePath");
    console.log(storagePath, studyInstanceUid, sopInstanceUid);
    const pathname =
      path.join(storagePath, studyInstanceUid, sopInstanceUid) + ".dcm";

    fs.readFile(pathname, (err, data) => {
      if (err) {
        res.statusCode = 500;
        res.json(json);
        return;
      }
      const dataset = dicomParser.parseDicom(data);

      // parse additional needed attributes
      const bitsAllocated = dataset.uint16("x00280100");
      const bitsStored = dataset.uint16("x00280101");
      const highBit = dataset.uint16("x00280102");
      const rows = dataset.uint16("x00280010");
      const cols = dataset.uint16("x00280011");
      const pixelSpacing = dataset.string("x00280030");
      const modality = dataset.string("x00080060");

      // all tags
      /*
      "0008193E" "LO"
      "0020000D" "UI"
      "0020000E" "UI"
      
      "00080005" "CS"
      "00080008" "CS"
      "00080016" "UI"
      "00080018" "UI"
      "00080020" "DA"
      "00080021" "DA"
      "00080022" "DA"
      "00080023" "DA"
      "00080030" "TM"
      "00080031" "TM"
      "00080032" "TM"
      "00080033" "TM"
      "00080050" "SH"
      "00080060" "CS"
      "00080070" "LO"
      "00080080" "LO"
      "00080090" "PN"
      "00081010" "SH"
      "00081030" "LO"
      "00081032" "SQ"
      "00081040" "LO"
      "00081070" "PN"
      "00081090" "LO"
      "00081110" "SQ"
      
      "00100010" "PN"
      "00100020" "LO"
      "00100021" "LO"
      "00100030" "DA"
      "00100040" "CS"
      "00101000" "LO"
      "00101010" "AS"
      "00101020" "DS"
      "00101030" "DS"
      "00104000" "LT"

      "00180015" "CS"
      "00180022" "CS"
      "00180050" "DS"
      "00180060" "DS"
      "00180090" "DS"
      "00181000" "LO"
      "00181020" "LO"
      "00181030" "LO"
      "00181100" "DS"
      "00181120" "DS"
      "00181130" "DS"
      "00181140" "CS"
      "00181150" "IS"
      "00181151" "IS"
      "00181152" "IS"
      "00181160" "SH"
      "00181170" "IS"
      "00181190" "DS"
      "00181210" "SH"
      "00185100" "CS"

      "00200010" "SH"
      "00200011" "IS"
      "00200012" "IS"
      "00200013" "IS"
      "00200020" "CS"
      "00200032" "DS"    
      "00200037" "DS"
      "00200052" "UI"
      "00200040" "LO"
      "00200041" "DS"

      "00280002" "US"
      "00280004" "CS"
      "00280010" "US"
      "00280011" "US"
      "00280030" "DS"
      "00280100" "US"
      "00280101" "US"
      "00280102" "US"
      "00280103" "US"
      "00281050" "DS"
      "00281051" "DS"
      "00281052" "DS"
      "00281053" "DS"
 
      "00321033" "LO"
      "00400002" "DA"
      "00400003" "TM"
      "00400004" "DA"
      "00400005" "TM"
      "00400244" "DA"
      "00400245" "TM"
      "00400253" "SH"
      "00400260" "SQ"
*/

      // append to all results
      for (let i = 0; i < json.length; i++) {
        json[i]["00280100"] = { Value: [bitsAllocated], vr: "US" };
        json[i]["00280101"] = { Value: [bitsStored], vr: "US" };
        json[i]["00280102"] = { Value: [highBit], vr: "US" };
        json[i]["00280010"] = { Value: [rows], vr: "US" };
        json[i]["00280011"] = { Value: [cols], vr: "US" };
        json[i]["00280030"] = { Value: [pixelSpacing], vr: "DS" };
        json[i]["00080060"] = { Value: [modality], vr: "CS" };
      }
      res.json(json);
    });
  }
);

//------------------------------------------------------------------

app.get(
  "/viewer/rs/studies/:studyInstanceUid/series/:seriesInstanceUid/instances/:sopInstanceUid/frames/:frame",
  middle,
  async (req, res) => {
    const {
      studyInstanceUid,
      seriesInstanceUid,
      sopInstanceUid,
      frame,
    } = req.params;
    logger.info(studyInstanceUid, seriesInstanceUid, sopInstanceUid, frame);

    const storagePath = config.get("storagePath");
    const pathname = path.join(storagePath, studyInstanceUid, sopInstanceUid) + ".dcm";

    fs.exists(pathname, function(exist) {
      if (!exist) {
        // if the file is not found, return 404
        res.statusCode = 404;
        res.end(`File ${pathname} not found!`);
        return;
      }

      // read file from file system
      fs.readFile(pathname, function(err, data) {
        if (err) {
          res.statusCode = 500;
          res.end(`Error getting the file: ${err}.`);
        } else {
          const term = "\r\n";
          const boundary = crypto.randomBytes(16).toString("hex");
          const contentId = crypto.randomBytes(16).toString("hex");
          const endline = `${term}--${boundary}--${term}`;

          res.writeHead(200, {
            "Content-Type": `multipart/related;start=${contentId};type="application/octed-stream";boundary="${boundary}"`,
          });

          res.write(`${term}--${boundary}${term}`);
          res.write(`Content-Location:localhost${term}`);
          res.write(`Content-ID:${contentId}${term}`);
          res.write(`Content-Type:application/octet-stream${term}`);
          res.write(term);
          res.write(data);
          res.write(endline);
          res.end();
        }
      });
    });
  }
);

//------------------------------------------------------------------

app.get("/viewer/wadouri", middle, async (req, res) => {
  const studyUid = req.query.studyUID;
  const seriesUid = req.query.seriesUID;
  const imageUid = req.query.objectUID;
  const storagePath = config.get("storagePath");
  const pathname = `${path.join(storagePath, studyUid, imageUid)}.dcm`;

  try {
    await utils.fileExists(pathname);
  } catch (error) {
    await utils.waitOrFetchData(studyUid, seriesUid);
  }
  // if the file is found, set Content-type and send data
  res.setHeader("Content-type", "application/dicom");

  // read file from file system
  fs.readFile(pathname, (err, data) => {
    if (err) {
      const msg = `Error getting the file: ${err}.`;
      logger.error(msg);
      res.statusCode = 500;
      res.end(msg);
    }
    res.end(data);
  });

  // clear data
  utils.clearCache(storagePath, studyUid, false);
});

//------------------------------------------------------------------

const port = config.get("webserverPort");
app.listen(port, async () => {
  logger.info(`webserver running on port: ${port}`);
  await utils.init();

  // if not using c-get, start our scp
  if (!config.get("useCget")) {
    utils.startScp();
  }

  utils.sendEcho();

  // clear data
  if (config.get("clearCacheOnStartup")) {
    const storagePath = config.get("storagePath");
    utils.clearCache(storagePath, "", true);
  }
});

//------------------------------------------------------------------
