const express = require("express");
const config = require("config");
const shell = require("shelljs");
const fs = require("fs").promises;
const path = require("path");
const dicomParser = require("dicom-parser");
const crypto = require("crypto");
const cors = require("cors");
const utils = require("./utils.js");

const app = express();
app.use(cors());

const logger = utils.getLogger();

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

app.get("/rs/studies", async (req, res) => {
  const tags = utils.studyLevelTags();

  const json = await utils.doFind("STUDY", req.query, tags);
  res.json(json);
});

//------------------------------------------------------------------
app.get("/viewer/rs/studies", async (req, res) => {
  const tags = utils.studyLevelTags();

  const json = await utils.doFind("STUDY", req.query, tags);
  res.json(json);
});

//------------------------------------------------------------------

app.get("/viewer/rs/studies/:studyInstanceUid/series", async (req, res) => {
  const { query } = req;
  query.StudyInstanceUID = req.params.studyInstanceUid;

  const tags = utils.seriesLevelTags();

  const json = await utils.doFind("SERIES", query, tags);
  res.json(json);
});

//------------------------------------------------------------------

app.get(
  "/viewer/rs/studies/:studyInstanceUid/series/:seriesInstanceUid/metadata",
  async (req, res) => {
    const { studyInstanceUid, seriesInstanceUid } = req.params;

    // fix for OHIF viewer assuming a lot of tags
    const tags = ["00080016", "00080018"];

    const { query } = req;
    query.StudyInstanceUID = req.params.studyInstanceUid;
    query.SeriesInstanceUID = req.params.seriesInstanceUid;

    const json = await utils.doFind("IMAGE", query, tags);
    // fetch series but wait for first image only
    await utils.waitOrFetchData(studyInstanceUid, seriesInstanceUid, false);
    if (json.length === 0) {
      logger.error("no metadata found");
      res.statusCode = 500;
      res.json(json);
      return;
    }

    const reading = [];
    const parsing = [];
    for (let i = 0; i < json.length; i += 1) {
      const sopInstanceUid = json[i]["00080018"].Value[0];
      const storagePath = config.get("storagePath");
      const pathname = path.join(
        storagePath,
        studyInstanceUid,
        `${sopInstanceUid}.dcm`
      );

      const readPromise = fs.readFile(pathname);
      reading.push(readPromise);
      readPromise.then((data) => {
        const dataset = dicomParser.parseDicom(data);

        // parse additional needed attributes
        const bitsAllocated = dataset.uint16("x00280100");
        const bitsStored = dataset.uint16("x00280101");
        const highBit = dataset.uint16("x00280102");
        const rows = dataset.uint16("x00280010");
        const cols = dataset.uint16("x00280011");
        const pixelSpacingString = dataset.string("x00280030");
        const pixelSpacing = pixelSpacingString
          ? pixelSpacingString.split("\\").map((e) => parseFloat(e))
          : [1, 1];
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
        const iopString = dataset.string("x00200037");
        const iop = iopString
          ? iopString.split("\\").map((e) => parseFloat(e))
          : null;
        const ippString = dataset.string("x00200032");
        const ipp = ippString
          ? ippString.split("\\").map((e) => parseFloat(e))
          : null;

        // append to all results

        json[i]["00080060"] = { Value: [modality], vr: "CS" };
        json[i]["00280002"] = { Value: [samplesPerPixel], vr: "US" };
        json[i]["00280004"] = { Value: [photometricInterpretation], vr: "CS" };
        json[i]["00280010"] = { Value: [rows], vr: "US" };
        json[i]["00280011"] = { Value: [cols], vr: "US" };
        json[i]["00280030"] = { Value: pixelSpacing, vr: "DS" };
        json[i]["00280100"] = { Value: [bitsAllocated], vr: "US" };
        json[i]["00280101"] = { Value: [bitsStored], vr: "US" };
        json[i]["00280102"] = { Value: [highBit], vr: "US" };
        json[i]["00280103"] = { Value: [pixelRepresentation], vr: "US" };
        json[i]["00281050"] = { Value: [wc], vr: "DS" };
        json[i]["00281051"] = { Value: [ww], vr: "DS" };
        json[i]["00281052"] = { Value: [rescaleIntercept], vr: "DS" };
        json[i]["00281053"] = { Value: [rescaleSlope], vr: "DS" };
        if (iop) json[i]["00200037"] = { Value: iop, vr: "DS" };
        if (ipp) json[i]["00200032"] = { Value: ipp, vr: "DS" };
        parsing.push(Promise.resolve());
      });
    }
    await Promise.all(reading);
    await Promise.all(parsing);
    res.json(json);
  }
);

//------------------------------------------------------------------

app.get(
  "/viewer/rs/studies/:studyInstanceUid/series/:seriesInstanceUid/instances/:sopInstanceUid/frames/:frame",
  async (req, res) => {
    const {
      studyInstanceUid,
      seriesInstanceUid,
      sopInstanceUid,
      frame,
    } = req.params;
    logger.info(studyInstanceUid, seriesInstanceUid, sopInstanceUid, frame);

    const storagePath = config.get("storagePath");
    const pathname = path.join(
      storagePath,
      studyInstanceUid,
      `${sopInstanceUid}.dcm`
    );

    try {
      await fs.access(pathname);
    } catch (error) {
      res.statusCode = 404;
      res.end(`File ${pathname} not found!`);
      return;
    }

    // read file from file system
    try {
      const data = await fs.readFile(pathname);
      const dataset = dicomParser.parseDicom(data);
      const pixelDataElement = dataset.elements.x7fe00010;
      const buffer = Buffer.from(
        dataset.byteArray.buffer,
        pixelDataElement.dataOffset,
        pixelDataElement.length
      );

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
    } catch (error) {
      logger.error(error);
      res.statusCode = 500;
      res.end(`Error getting the file: ${error}.`);
    }
  }
);

//------------------------------------------------------------------

app.get("/viewer/wadouri", async (req, res) => {
  const studyUid = req.query.studyUID;
  const seriesUid = req.query.seriesUID;
  const imageUid = req.query.objectUID;
  const storagePath = config.get("storagePath");
  const pathname = `${path.join(storagePath, studyUid, imageUid)}.dcm`;

  try {
    await utils.fileExists(pathname);
  } catch (error) {
    await utils.waitOrFetchData(studyUid, seriesUid, false);
  }
  // if the file is found, set Content-type and send data
  res.setHeader("Content-type", "application/dicom");

  // read file from file system
  try {
    const data = await fs.readFile(pathname);
    res.end(data);
  } catch (error) {
    const msg = `Error getting the file: ${error}.`;
    logger.error(msg);
    res.statusCode = 500;
    res.end(msg);
  }

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
