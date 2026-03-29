// ── In-memory job store ────────────────────────────────────────────────────────
const jobs  = {};  // jobId -> { status, progressPath, outputFile, error }
const procs = {};  // jobId -> ChildProcess (so we can kill on quit)

function getJob(id)       { return jobs[id]; }
function setJob(id, data) { jobs[id] = data; }

function getProc(id)       { return procs[id]; }
function setProc(id, proc) { procs[id] = proc; }
function deleteProc(id)    { delete procs[id]; }

// Kill any running FFmpeg jobs when the process exits
process.on('exit', () => {
  Object.values(procs).forEach(p => { try { p.kill(); } catch {} });
});

module.exports = { getJob, setJob, getProc, setProc, deleteProc };
