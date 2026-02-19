import { app, errorHandler } from "mu";
import { createJob, getJob, JobManager, cleanupOngoingJobs } from "./lib/jobs";
import { generateReport } from "./lib/report-generation";
import { getReportsForMeeting } from "./lib/bundle-generation";
import { CronJob } from "cron";

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
app.post("/:id", async function (req, res, next) {
  try {
    const shouldRegenerateConcerns = req.body.shouldRegenerateConcerns === true;
    const fileMeta = await generateReport(req.params.id, req.headers, shouldRegenerateConcerns);
    res.status(200).send(fileMeta);
  } catch (e) {
    console.error(e);
    next({ message: e.message, status: 500 });
  }
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
    const isBundleJob = false;
    const shouldRegenerateConcerns = req.body.shouldRegenerateConcerns === true;
    const generationJob = await createJob(req.body.reports, req.headers, isBundleJob, shouldRegenerateConcerns);
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
