# Diagrams showing simulator envents and diagnostics.

A description for each emitted event is written inside the `Simulator` class in `/src/simulator.js`.

### Task without jobs.
<img src="task without jobs.png" alt="Alt text" title="Task without jobs.">

Blue bubbles are events emitted by the `Simulator`.

When a session ends, it checks if there were any pending ACS requests. That check is not represented in the diagrams because there's nothing more to it. If there is a pending ACS request, it starts a new session. But if not, 
it checks if there is any diagnostic queued, and then checks if there is any pending action queued.

`diagnostic?` is a check for the diagnostics queue. Because there were not diagnostic request this step is skipped.

`pending?` is a check for the pending actions queue. Because there were pending actions step is skipped.

To get the order of actions after the session, see `startSession()` in `/src/simulator.js`.

<br>

### Events during a session
<img src="task events.png" alt="Alt text" title="Events during a session">

`task` is emitted after the `Simulator` knows the ACS has acknowledged that the `Simulator` has executed the task.

`task` is emitted after `response` is emitted.


<br>

### Task with a diagnostic
<img src="task with one diagnostic.png" alt="Alt text" title="Task with a diagnostic">

When a task requests a diagnostic, the `Simulator` adds that diagnostic, as a promise, to a diagnostic queue (`queue diagnostic`).

Orange bubbles are moments when a queue is incremented.

After a session ends, the `Simulator` checks if there is any diagnostic queued (the `diagnostic?` box in the diagrams) and runs the first one (the `diagnostic` box in the diagrams).

When that diagnostic finishes, it adds a pending action, as a promise, to a queue (`queue pending`). That queued action starts a `8 DIAGNOSTICS COMPLETE` session, resolves its diagnostic promise and then emits the `"diagnostic"` event.

The session started by the finished diagnostic's pending action is a normal session, that passes through all steps. Because the diagnostic promise only resolves after that `8 DIAGNOSTICS COMPLETE` session ends, the `diagnostic?` check is skipped.

`busy` is written to represent that the `diagnostic?` check was skipped because there was already a diagnostic being simulated at that time, which was the diagnostic that started that very session. A finished diagnostic never runs the `diagnostic?` check in the session it starts because the diagnostic promise only resolves after the `8 DIAGNOSTICS COMPLETE` session ends.

Recommended read is `runRequestedDiagnostics()` and `runPendingEvents()` in `/src/simulator.js`.

<br>

### Two tasks with diagnostics no overlap
<img src="two tasks with diagnostics no overlap.png" alt="Alt text" title="Two tasks with diagnostics no overlap">

In this example, a second diagnostic is requested during the simulation of a previously requested diagnostic. But by the time the first diagnostic runs its finishing pending action, the second session had already ended, so the first diagnostic finishes seeing no session conflict.

After the second session, the `diagnostic?` check is skipped because the first diagnostic was still running, so concurrent logic settles with nothing to do.

After the first diagnostic is resolves, the `diagnostic?` check sees the second diagnostic and runs it right away.


### Two tasks with diagnostics with overlap
<img src="two tasks with diagnostics with overlap.png" alt="Alt text" title="Two tasks with diagnostics with overlap">

In this example, a second diagnostic is requested during the simulation of a previously requested diagnostic but when the first diagnostic finishes there is an on going session running (the second session), preventing the first diagnostic to start its `8 DIAGNOSTICS COMPLETE` session. So the first diagnostic settles, without resolving its promise, not knowing if it would ever resolve, but the pending action is still queued.

The second sessions requests a second diagnostic, adding another diagnostic to the diagnostic queue. When the second sessions finishes, it skips its `diagnostic?` check because the first diagnostic is still being awaited. Then it runs the `pending?` check and sees a pending promise to be run, which starts the first diagnostic's `8 DIAGNOSTICS COMPLETE` session and resolves its promise, allowing the `diagnostic?` check (the one that run the first diagnostic) to start the second diagnostic.

<br>