import { app, errorHandler } from "mu";
import { createJob, getJob, JobManager, cleanupOngoingJobs } from "./lib/jobs";
import { generateReport } from "./lib/report-generation";
import { getReportsForMeeting } from "./lib/bundle-generation";
import { CronJob } from "cron";
import { generateConcernsPart } from "./lib/render-report";
import {
  getAgendaitemData,
  getAgendaitemPiecesForReport,
  getRatificationName,
  updateAgendaitemConcerns,
} from "./lib/agendaitem";

// on startup
cleanupOngoingJobs();

const jobManager = new JobManager();
jobManager.run();

/** Schedule report generation cron job */
const cronFrequency = process.env.REPORT_CRON_PATTERN || "0 * * * * *";
new CronJob(
  cronFrequency,
  function () {
    console.log(`Jobs triggered by cron job at ${new Date().toISOString()}`);
    jobManager.run();
  },
  null,
  true
);

/* Generate a single report */
app.get("/:id", async function (req, res, next) {
  try {
    const fileMeta = await generateReport(req.params.id, req.headers);
    res.status(200).send(fileMeta);
  } catch (e) {
    console.error(e);
    next({ message: e.message, status: 500 });
  }
});

app.post("/generate-concerns/:id", async function (req, res, next) {
  const agendaitemId = req.params.id;
  if (!agendaitemId) {
    return res.status(400).send("No agendaitem id supplied");
  }
  const agendaitem = await getAgendaitemData(req.params.id);
  if (!agendaitem) {
    return res.status(404).send("No agendaitem with this id");
  }
  const { shortTitle, title, isApproval, subcaseName } = agendaitem;
  const pieces = await getAgendaitemPiecesForReport(agendaitemId, isApproval);
  const ratification = await getRatificationName(agendaitemId);
  const documentNames = pieces.map((piece: any) => piece.name);
  if (ratification) {
    documentNames.unshift(ratification);
  }
  const concerns = generateConcernsPart(
    shortTitle,
    title,
    isApproval,
    documentNames,
    subcaseName
  );

  await updateAgendaitemConcerns(agendaitemId, concerns);

  return res.end();
});

/*
  Requires req.body to contain a non-empty array 'reports' with report URIs.
  Returns the ID of the generation job.
*/
app.post("/generate-reports", async function (req, res, next) {
  if (!req.body?.reports || req.body.reports.length === 0) {
    return next({ message: "Reports cannot be empty" });
  }
  try {
    const generationJob = await createJob(req.body.reports, req.headers);
    res.status(200);
    res.send(JSON.stringify(generationJob));
    jobManager.run();
  } catch (e) {
    console.error(e);
    next({ message: e.message, status: 500 });
  }
});

app.post("/generate-reports-bundle", async function (req, res, next) {
  if (!req.body?.meetingId) {
    return next({ message: "Meeting id cannot be empty" });
  }
  try {
    const reports = await getReportsForMeeting(req.body.meetingId);
    if (!reports.length) {
      return next({
        message:
          'No reports found that are suitable for bundling. Only reports with access-level "intern-overheid" are bundled.',
      });
    }
    const isBundleJob = true;
    const bundleGenerationJob = await createJob(
      reports,
      req.headers,
      isBundleJob
    );
    res.status(200);
    res.send(JSON.stringify(bundleGenerationJob));
    jobManager.run();
  } catch (e) {
    console.error(e);
    next({ message: e.message, status: 500 });
  }
});

app.get("/job/:id", async function (req, res, next) {
  try {
    const job = await getJob(req.params.id);
    if (job) {
      res.status(200);
      res.send(JSON.stringify(job));
    } else {
      next({ message: "Job not found", status: 404 });
    }
  } catch (e) {
    console.error(e);
    next({ message: e.message, status: 500 });
  }
});

app.use(errorHandler);
