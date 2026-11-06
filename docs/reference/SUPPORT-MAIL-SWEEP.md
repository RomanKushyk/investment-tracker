# Support mail sweep — how support@ mail keeps 12 months

`/privacy` says support@ correspondence is kept 12 months after a thread's last message, and deleted sooner on request from the same address. No code in this repository can reach that mail. Cloudflare forwards support@quirenote.com into the owner's Gmail, which holds personal mail too, so a Gmail filter labels the support threads and an Apps Script in the same account trashes the old ones every day. The ruling is under "Legal documents" in [`../DECISIONS.md`](../DECISIONS.md). This page is the script's source of record: the editor copy is kept in step with it by hand, and `scripts/support-mail-sweep.test.ts` runs the fence below against a fake Gmail.

## Why 330 days

A thread is trashed once its last message is more than 330 days old. A daily trigger lands somewhere in its hour, so a thread waits about a day at most for the next run, and Gmail deletes a message for good 30 days after it reaches the Trash ("After 30 days: The message is permanently deleted", [Gmail Help](https://support.google.com/mail/answer/7401)). So, while the trigger runs, the worst case is 330 + 1 + 30 = 361 days, inside 12 months. The margin is four days: a failure email left unanswered for longer than that breaks the promise.

The age is the thread's: `getLastMessageDate()` "Gets the date of this thread's most recent message" ([GmailThread](https://developers.google.com/apps-script/reference/gmail/gmail-thread)), so a reply restarts the 12 months. A thread is trashed whole, every message in it, once its last one is old enough. Threads already in the Trash are skipped (`isInTrash()`).

## The filter

- **Matches** `to:support@quirenote.com`.
- **Applies** the label `quirenote.com/support` (`support` nested under `quirenote.com`; it searches as `label:quirenote.com-support`).
- **"Also apply filter to matching conversations"** is ticked, so support mail that arrived before the filter carries the label too ([Gmail Help](https://support.google.com/mail/answer/90559)).

The script finds the label by its exact name and fails when it is gone, so renaming or deleting it sends the failure email below instead of sweeping nothing. A rename changes `LABEL` here, in the editor and in the test.

## The script

```js
// Trashes support@ threads whose last message is over 330 days old, so none outlives /privacy's
// 12 months. Source of record: docs/reference/SUPPORT-MAIL-SWEEP.md in the Quirenote repository.
const LABEL = 'quirenote.com/support';
const MAX_AGE_DAYS = 330;
const PAGE = 100;

function dryRun() {
  run_(false);
}

function sweep() {
  run_(true);
}

// Trashes on `true` alone: a trigger wired here directly would pass its event object.
function run_(trash) {
  const label = GmailApp.getUserLabelByName(LABEL);
  // A renamed label would sweep nothing in silence; a failure sends the owner Google's email.
  if (!label) throw new Error(`No label named ${LABEL}`);
  const cutoff = new Date(Date.now() - MAX_AGE_DAYS * 24 * 60 * 60 * 1000);
  const due = [];
  // Every page is read before anything moves, since a trashed thread would shift the next page.
  for (let start = 0; ; start += PAGE) {
    const page = label.getThreads(start, PAGE);
    for (const thread of page) {
      // A trashed thread keeps its label; trashing it again would only repeat it in the log.
      if (!thread.isInTrash() && thread.getLastMessageDate() < cutoff) due.push(thread);
    }
    if (page.length < PAGE) break;
  }
  let count = 0;
  for (const thread of due) {
    // A thread holds the state it loaded; a reply since the scan keeps it. This narrows the window
    // to the moment before the trash, it does not close it.
    const last = thread.refresh().getLastMessageDate();
    if (last >= cutoff) continue;
    if (trash === true) thread.moveToTrash();
    count++;
    Logger.log(`${trash === true ? 'trashed' : 'would trash'} ${thread.getId()}, last ${last.toISOString()}`);
  }
  Logger.log(`${count} thread(s) ${trash === true ? 'trashed' : 'due'}`);
}
```

The log names a thread by its id and date, never by an address or a subject.

## Setting it up

1. At [script.google.com](https://script.google.com), signed in as the Gmail account that receives the forward, create a project, name it `Quirenote support mail sweep`, and paste the script over the editor's contents.
2. Choose `dryRun` — not `sweep`, which trashes at once — and press Run. Grant the Gmail access it asks for: GmailApp's methods "require authorization with the https://mail.google.com/ scope" ([GmailApp](https://developers.google.com/apps-script/reference/gmail/gmail-app)).
3. Read the execution log. "No label named …" means the name in `LABEL` is not the label's; fix it and run again. Otherwise each line is a thread it would trash, and the last line is the count. A thread you do not expect there means the label reaches mail it should not: stop and fix the filter.
4. At the left, click Triggers; at the bottom right, Add Trigger ([installable triggers](https://developers.google.com/apps-script/guides/triggers/installable)). Choose the function `sweep`, the event source "Time-driven", a daily timer at any hour. Set the failure notifications to the most frequent the dialog offers, and Save: they cannot be turned off while the trigger is active ("you can only adjust the frequency of these notifications"), and a digest that waits longer than the four-day margin above lets mail outlive 12 months.

## When something goes wrong

- **A "Summary of failures for Apps Script" email** from `noreply-apps-scripts-notifications@google.com` means the sweep failed ([installable triggers](https://developers.google.com/apps-script/guides/triggers/installable)). If the access was revoked, the run fails "immediately with an "Authorization is required to perform that action." error" ([scopes](https://developers.google.com/apps-script/concepts/scopes)): open the project, run `dryRun` once and grant the access again. If the log says "No label named …", the label was renamed or deleted: restore it, or change `LABEL` here and in the editor. Nothing in this repository watches the trigger; that email is the only signal. Nothing watches the filter either: if it is deleted or edited, the label stays, the sweep keeps running and new support mail is never labelled, so a change to the filter is a change to this page.
- **A request to delete sooner**, from the address that wrote: find the thread under the label, delete it, then open the Trash and choose "Delete forever" for it the same day.
- **A message from someone with no account** is deleted by hand once answered, the same way.

The sweep moves threads to the Trash rather than deleting them outright: the Gmail API's own advice on a permanent delete is "Prefer threads.trash instead" ([users.threads.delete](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.threads/delete)).
