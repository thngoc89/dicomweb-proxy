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
const middle = function middle(req, res, next) {
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
process.on("uncaughtException", (err) => {
  logger.info("uncaught exception received:");
  logger.info("------------------------------------------");
  logger.error(err.stack);
  logger.info("------------------------------------------");
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
    await utils.waitOrFetchData(
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

    const sopInstanceUid = json[0]["00080018"].Value[0];
    const storagePath = config.get("storagePath");
    const pathname = path.join(storagePath, studyInstanceUid, `${sopInstanceUid}.dcm`);

    fs.readFile(pathname, (err, data) => {
      if (err) {
        res.statusCode = 500;
        res.json(json);
        return;
      }
      const dataset = dicomParser.parseDicom(data);

      // all tags
      /*
      "0008193E" "LO"
      "0020000D" "UI"
      "0020000E" "UI"
      
      "00080005" "CS" "Specific Character Set"
      "00080008" "CS" "Image Type"
      "00080016" "UI" "SOP Class UID"
      "00080018" "UI" "SOP Instance UID"
      "00080020" "DA" "Study Date"
      "00080021" "DA" "Series Date"
      "00080022" "DA" "Acquisition Date"
      "00080023" "DA" "Content Date"
      "00080030" "TM" "Study Time"
      "00080031" "TM" "Series Time"
      "00080032" "TM" "Acq. Time"
      "00080033" "TM" "Content Time"
      "00080050" "SH" "Accession Number"
      "00080060" "CS" "Modality"
      "00080070" "LO" "Manufacturer"
      "00080080" "LO" "Institution Name"
      "00080090" "PN" "Referring Physician's Name"
      "00081010" "SH" "Station Name"
      "00081030" "LO" "Study Description"
      "00081032" "SQ" "Procedure Code Sequence"
      "00081040" "LO" "Institutional Department Name"
      "00081070" "PN" "Operators Name"
      "00081090" "LO" "Manufacturer's Model Name"
      "00081110" "SQ" "Referenced Study Sequence"
      
      "00100010" "PN" "Patient's Name"
      "00100020" "LO" "Patient ID"
      "00100021" "LO" "Issuer of Patient ID"
      "00100030" "DA" "Patient's Birth Date"
      "00100040" "CS" "Patient Sex"
      "00101000" "LO" "?"
      "00101010" "AS" "Patient's Age"
      "00101020" "DS" "Patient's Size"
      "00101030" "DS" "Patient's Weight"
      "00104000" "LT" "Patient Comments"

      "00180015" "CS" "Body Part Examined"
      "00180022" "CS" "Scan Options"
      "00180050" "DS" "Slice Thickness"
      "00180060" "DS" "KVP"
      "00180090" "DS" "Data Collection Diameter"
      "00181000" "LO" "Device Serial Number"
      "00181020" "LO" "Software Version"
      "00181030" "LO" "Protocol Name"
      "00181100" "DS" "Reconstruction Diameter"
      "00181120" "DS" "Gantry/Detector Tilt"
      "00181130" "DS" "Table Height"
      "00181140" "CS" "Rotation Direction"
      "00181150" "IS" "Exposure Time"
      "00181151" "IS" "X-Ray Tube"
      "00181152" "IS" "Exposure Attribute"
      "00181160" "SH" "Filter Type"
      "00181170" "IS" "Generator Power"
      "00181190" "DS" "Focal Spots"
      "00181210" "SH" "Convolution Kernel"
      "00185100" "CS" "Patient Position"

      "00200010" "SH" "Study ID"
      "00200011" "IS" "Series Number"
      "00200012" "IS" "Acquisition Number"
      "00200013" "IS" "Instance Number"
      "00200020" "CS" "Patient Orientation"
      "00200032" "DS" "Image Postion"
      "00200037" "DS" "Image Orientation"
      "00200052" "UI" "Frame of Reference UID"
      "00201040" "LO" "Position Reference Indicator"
      "00201041" "DS" "Slice Location"

      "00280002" "US" "Samples per Pixel"
      "00280004" "CS" "Photometric Interpretation"
      "00280010" "US" "Rows"
      "00280011" "US" "Columns"
      "00280030" "DS" "Pixel Spacing"
      "00280100" "US" "Bits Allocated"
      "00280101" "US" "Bits Stored"
      "00280102" "US" "High Bit"
      "00280103" "US" "Pixel Representation"
      "00281050" "DS" "Window Center"
      "00281051" "DS" "Window Width"
      "00281052" "DS" "Rescale Intercept"
      "00281053" "DS" "Rescale Slope"
 
      // modality 
      "00321033" "LO" "Requesting Service"
      "00400002" "DA" ""
      "00400003" "TM"
      "00400004" "DA"
      "00400005" "TM"
      "00400244" "DA"
      "00400245" "TM"
      "00400253" "SH"
      "00400260" "SQ"
     */

      // parse additional needed attributes
      const bitsAllocated = dataset.uint16("x00280100");
      const bitsStored = dataset.uint16("x00280101");
      const highBit = dataset.uint16("x00280102");
      const rows = dataset.uint16("x00280010");
      const cols = dataset.uint16("x00280011");
      const pixelSpacing = dataset.string("x00280030");
      const arr = pixelSpacing ? pixelSpacing.split("\\") : ["1", "1"];
      const px = parseFloat(arr[0]);
      const py = parseFloat(arr[1]);
      const modality = dataset.string("x00080060");
      const samplesPerPixel = dataset.uint16("x00280002");
      const photometricInterpretation = dataset.string("x00280004");
      const pixelRepresentation = dataset.uint16("x00280103");
      const windowCenter = dataset.string("x00281050");
      const wc = windowCenter ? parseFloat(windowCenter.split("\\")[0]) : 40;
      const windowWidth = dataset.string("x00281051");
      const ww = windowWidth ? parseFloat(windowWidth.split("\\")[0]) : 80;
      const rescaleIntercept = parseFloat(dataset.string("x00281052"));
      const rescaleSlope = parseFloat(dataset.string("x00281053"));

      // append to all results
      for (let i = 0; i < json.length; i+=1) {
        json[i]["00080060"] = { Value: [modality], vr: "CS" };

        json[i]["00280002"] = { Value: [samplesPerPixel], vr: "US" };
        json[i]["00280004"] = { Value: [photometricInterpretation], vr: "CS" };
        json[i]["00280010"] = { Value: [rows], vr: "US" };
        json[i]["00280011"] = { Value: [cols], vr: "US" };
        json[i]["00280030"] = { Value: [px, py], vr: "DS" };
        json[i]["00280100"] = { Value: [bitsAllocated], vr: "US" };
        json[i]["00280101"] = { Value: [bitsStored], vr: "US" };
        json[i]["00280102"] = { Value: [highBit], vr: "US" };
        json[i]["00280103"] = { Value: [pixelRepresentation], vr: "US" };
        json[i]["00281050"] = { Value: [wc], vr: "DS" };
        json[i]["00281051"] = { Value: [ww], vr: "DS" };
        json[i]["00281052"] = { Value: [rescaleIntercept], vr: "DS" };
        json[i]["00281053"] = { Value: [rescaleSlope], vr: "DS" };
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
    const pathname = path.join(storagePath, studyInstanceUid, `${sopInstanceUid}.dcm`);


    fs.exists(pathname, exist => {
      if (!exist) {
        // if the file is not found, return 404
        res.statusCode = 404;
        res.end(`File ${pathname} not found!`);
        return;
      }

      // read file from file system
      fs.readFile(pathname, (err, data) => {
        if (err) {
          res.statusCode = 500;
          res.end(`Error getting the file: ${err}.`);
        } else {
          const dataset = dicomParser.parseDicom(data);
          const pixelDataElement = dataset.elements.x7fe00010;
          const buffer = Buffer.from(dataset.byteArray.buffer, pixelDataElement.dataOffset, pixelDataElement.length);

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
          res.write(buffer);
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
