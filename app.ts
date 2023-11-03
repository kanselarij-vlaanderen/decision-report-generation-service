import { app } from "mu";
import { createJob, getJob, JobManager } from "./lib/jobs";
import { generateReport } from "./lib/report-generation";
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
app.get("/:id", async function (req, res) {
  try {
    const fileMeta = await generateReport(req.params.id, req.headers);
    res.status(200).send(fileMeta);
  } catch (e) {
    res.status(500);
    console.error(e);
    res.send(e);
  }
});

/*
  Requires req.body to contain a non-empty array 'reports' with report URIs.
  Returns the ID of the generation job.
*/
app.post("/generate-reports", async function (req, res) {
  if (!req.body?.reports || req.body.reports.length === 0) {
    res.status(400);
    res.send("reports cannot be empty");
    return;
  }
  try {
    const generationJob = await createJob(req.body.reports, req.headers);
    res.status(200);
    res.send(JSON.stringify(generationJob));
    jobManager.run();
  } catch (e) {
    res.status(500);
    console.error(e);
    res.send(e);
  }
});

app.get("/job/:id", async function (req, res) {
  try {
    const job = await getJob(req.params.id);
    if (job) {
      res.status(200);
      res.send(JSON.stringify(job));
    } else {
      res.status(404);
      res.send({ message: 'Job not found' });
    }
  } catch (e) {
    res.status(500);
    console.error(e);
    res.send(e);
  }
});
