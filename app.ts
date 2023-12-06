import { app, errorHandler } from "mu";
import { createJob, getJob, JobManager } from "./lib/jobs";
import { generateReport, generateReportBundle } from "./lib/report-generation";
import { CronJob } from 'cron';

const jobManager = new JobManager();
jobManager.run();

/** Schedule report generation cron job */
const cronFrequency = process.env.REPORT_CRON_PATTERN || '0 * * * * *';
new CronJob(cronFrequency, function() {
  console.log(`Jobs triggered by cron job at ${new Date().toISOString()}`);
  jobManager.run();
}, null, true);

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

/*
  Requires req.body to contain a non-empty array 'reports' with report URIs.
  Returns the ID of the generation job.
*/
app.post("/generate-reports", async function (req, res, next) {
  if (!req.body?.reports || req.body.reports.length === 0) {
    return next({ message: 'Reports cannot be emtpy' });
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
  if (!req.body?.reports || req.body.reports.length === 0) {
    return next({ message: 'Reports cannot be empty' });
  }
  try {
    const fileMeta = await generateReportBundle(req.body.reports, req.headers);
    res.status(200).send(fileMeta);
  } catch(e) {
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
      next({ message: 'Job not found', status: 404 });
    }
  } catch (e) {
    console.error(e);
    next({ message: e.message, status: 500 });
  }
});

app.use(errorHandler);
