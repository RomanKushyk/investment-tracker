# infra — one-time console setup, SES, and the Inzhur sanction check

> Moved **verbatim** from [`../README.md`](../README.md) on 2026-08-26 (D95). These are `### ` sections of the README's **Deploying** chapter. Done once; kept because a rebuild needs every step.

### Is reading the Inzhur feed sanctioned? — checked 2026-08-14

The handler must send a `User-Agent` or the request 403s, which reads at first
like a door being closed. It is not one, and the evidence is worth keeping
because the question will be asked again:

- **The block is on the ABSENCE of a UA, not on ours.** No UA -> 403 with a
  generic CloudFront error page; our honest `quirenote-price-capture/1.0
  (+https://quirenote.com)` -> 200; a bare `Mozilla/5.0` -> 200. That is AWS
  WAF's stock `NoUserAgent_HEADER` bot-hygiene rule, not a targeted measure. A
  site hiding an endpoint would block the self-identifying agent first.
- **`https://www.inzhur.reit/robots.txt` allows it.** `User-agent: * / Allow: /`,
  with a curated deny list — `/dashboard/`, `/signin/`, `/signup/`, `/documents`,
  `/fund_merger_report`, `/annual_report_2025`, `/terms`, `/privacy-policy`.
  They thought about what to exclude; `/_api/` is not excluded.
- **It is the site's own public endpoint**, the same one the SPA read directly
  from visitors' browsers before the capture existed (D19: "public marketing
  endpoint, not a documented API"), fetched as a bare GET with no credentials.
- **Volume is one request a day** — and only up to six on a day the capture
  fails, because `alreadySettled` checks before fetching (D64).

**The contract was then read** — the owner downloaded it in a browser rather than
letting anything here crawl `/terms`, which `robots.txt` disallows: reading it
with a crawler while arguing that we respect their crawl rules would be
self-refuting. It is *Договір про надання фінансових послуг щодо цінних паперів
«INZHUR»*, the client agreement of ТОВ «ІНЖУР КЕПІТАЛ», edition of 12.08.2026,
35 pages. Three findings:

- **Its subject is the client relationship, not the website.** §1.6 defines the
  Site as the depositary institution's official page, and §1.46 defines the
  "Software Module" as the Personal Cabinet and the mobile app — the
  AUTHENTICATED surface. §13 governs a Client's access to that module. The
  unauthenticated `/_api/assets` the capture reads is not that.
- **No clause prohibits automated access, scraping, copying or reproduction.**
  Searched for the verbs that would carry such a rule — заборон / не має права /
  копіювання / відтворення / автоматизован / програмн / інтелектуальн /
  торговельна марка — and every prohibition found concerns something else
  (guaranteeing profit, the bonus programme, statutory limits).
- **Confidentiality carves this out explicitly.** §6.1 makes information
  exchanged under the contract confidential *"крім інформації, що може бути
  отримана будь-якою особою з загальнодоступних джерел"* — except information
  any person can obtain from publicly accessible sources. A feed served
  unauthenticated to any browser, and allowed by their own robots.txt, is that.

**Stated as what it is:** a targeted read of a 35-page contract by someone who is
not a lawyer — "no prohibition found where a prohibition would live", not a
clearance.

### SES, created by hand and outside the stack (2026-08-14)

Mail has no CloudFormation of its own yet — it is not wired to anything until W7.
What exists in the account: the verified domain `quirenote.com` (Easy DKIM, custom
MAIL FROM `mail.quirenote.com`, SPF on it, DMARC `p=none`), and a configuration set
**`quirenote-mail`** with reputation metrics enabled and an event destination
`problems-to-eventbridge` sending BOUNCE, COMPLAINT, REJECT, DELIVERY_DELAY and
RENDERING_FAILURE to the default EventBridge bus — the same channel the alarms use,
and the reason no SNS topic appears here either (D45/D47). It is the identity's
DEFAULT configuration set, so a sender that forgets to name one still gets it.

The account is still in the **sandbox**: 200 messages/day, 1/s, verified recipients
only. Production access was denied once; `PLAN-NOW.md` A11 records what was audited
and why the resubmission waits for W7.

### One-time console setup

Two roles, deliberately. The GitHub role can do almost nothing by itself — it
may only drive CloudFormation on one named stack and hand it the execution
role. The broad permissions live on the execution role, which only
CloudFormation can assume. This is what keeps a compromised workflow from
creating arbitrary resources, and it is the reason not to use CDK here: CDK's
bootstrap execution role is `AdministratorAccess` by default.

The OIDC provider already exists from the frontend setup
(`docs/reference/DEPLOYMENT.md` §1.4) — do not create a second one.

The two roles below are the ones in use. They replaced a `kubushka-backend-*`
pair on 2026-08-11 (D42/D46); the old pair is deleted and only these exist.
Replace `<account-id>` with the account's own id — it is deliberately not
written down in this repository, which is public.

Three things about their shape are worth knowing, and one is a trap:

- the exec policy scopes **eight** ARN patterns — `cloudformation`, `lambda`,
  `iam`, `logs`, `sqs`, `sns`, `cloudwatch`, `scheduler` — and every one of
  them carries the `quirenote-backend-*` prefix SAM derives from the stack
  name;
- the SAM artifacts bucket is `quirenote-sam-artifacts-<account-id>`, holding
  only disposable upload artifacts;
- **the DSQL resource stays `cluster/*`** — DSQL cluster IDs are generated, not
  named, so there is no prefix to change. A consequence worth knowing during E3:
  the new exec role can therefore reach the *old* cluster too. CloudFormation
  will not touch it, because it is not in the new stack, but the teardown does
  not need extra permission either.

The trust policy keys on the **environment** rather than the branch, and the
owner/repo carry immutable numeric IDs. Both traps are documented at length in
`docs/reference/DEPLOYMENT.md` §1.5.

### The artifacts bucket, if the account is ever rebuilt

```bash
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
aws s3api create-bucket \
  --bucket "quirenote-sam-artifacts-${ACCOUNT_ID}" \
  --region eu-north-1 \
  --create-bucket-configuration LocationConstraint=eu-north-1
aws s3api put-public-access-block \
  --bucket "quirenote-sam-artifacts-${ACCOUNT_ID}" \
  --public-access-block-configuration \
    BlockPublicAcls=true,IgnorePublicAcls=true,BlockPublicPolicy=true,RestrictPublicBuckets=true
```

`bootstrap-account.sh` does this; the commands are here because a bucket that
does not exist fails the deploy with an error that names S3 rather than the
missing bucket.
