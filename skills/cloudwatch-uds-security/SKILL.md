---
name: cloudwatch-uds-security
description: >-
  Prepares an AWS account for, deploys, and operates the CloudWatch Unified Data Store (UDS)
  for security use cases. Autonomously validates prerequisites (CloudTrail management/data
  events and VPC Flow Logs flowing to CloudWatch Logs via the @data_source_name facet),
  auto-configures anything missing (telemetry enablement rules / service-linked channels),
  and deploys the CloudTrail + VPC Flow Logs Security Visibility Dashboard via CloudFormation
  (Standard or OCSF format). Also guides direct security analysis of logs, metrics, and
  telemetry from the UDS: CloudWatch Logs Insights with SOURCE logGroups() + filterIndex on
  default facets, and SQL over the S3 Tables (Apache Iceberg) integration via Amazon Athena.
  Use when a human operator asks to "prepare my account and deploy the CloudWatch Unified
  Data Store", set up the UDS security dashboard, enable data sources/facets, query CloudTrail
  or VPC Flow Logs across log groups without knowing log group names, run security queries,
  investigate incidents, or analyze UDS data with Athena/S3 Tables. Covers CloudTrail, VPC
  Flow Logs, WAF, Route 53 Resolver, OCSF normalization, facets, pipelines, cross-account
  cross-Region centralization, and detective/monitoring alarms.
version: 1
metadata:
  service: [cloudwatch, cloudwatchlogs, cloudtrail, vpc, s3tables, athena, observabilityadmin]
  task: [prepare, validate, deploy, configure, query, investigate, monitor]
  persona: [security-engineer, devops, cloud-operations, incident-responder]
  workload: [security, observability, compliance]
---

# CloudWatch Unified Data Store — Security

## Overview

The Amazon CloudWatch **Unified Data Store (UDS)** unifies operational, security, and
compliance log data across AWS services, accounts, and Regions in one place — with no ETL
pipelines and no need to know individual log group names. It automatically categorizes logs by
their originating **data source** (for example `aws_cloudtrail`, `amazon_vpc`) and exposes them
as **default facets** (`@data_source_name`, `@data_source_type`, `@data_format`, `@aws.region`)
that queries and dashboards use to discover the right logs dynamically. The same data is also
available as **Apache Iceberg tables in Amazon S3 Tables** at no additional storage charge, so
you can run SQL over it with Amazon Athena and correlate it with other data.

This skill does two things for **security** use cases:

1. **Autonomously prepares an account and deploys the UDS Security Visibility Dashboard** — a
   CloudFormation-deployed CloudWatch dashboard for CloudTrail API activity and VPC Flow Logs
   network activity, in Standard or OCSF format. See the deployment workflow below.
2. **Guides direct analysis of UDS data** — Logs Insights queries (facet-scoped) and SQL over
   the S3 Tables integration through Athena, with a reusable library of security queries.

**Works best with the AWS MCP server** — use it to run CLI commands, validate prerequisites,
create resources, deploy the stack, and run queries directly. All guidance also works with a
standard AWS CLI. Treat every command as an action against the operator's live account: honor
the confirmation gates in the workflow before making changes.

**Note:** UDS is a newer capability and features, Region availability, and CLI shapes evolve.
When precision matters (production changes, quotas, exact API parameters), confirm against the
current AWS docs rather than relying solely on values in these files.

## The prompt this skill answers

> "Please prepare my account and deploy the CloudWatch Unified Data Store."

Run the **end-to-end workflow** below. It is designed to be executed autonomously, pausing only
at the confirmation gates that change account state or incur cost.

## End-to-end deployment workflow

Execute the phases in order. Each phase references a detailed guide — read it before acting in
that phase. Do not skip the prerequisite phase: the dashboard is read-only and will render empty
widgets if the data sources are not present.

### Phase 0 — Establish context (no changes)
1. Confirm the **target account and Region** (`aws sts get-caller-identity`, resolve region).
   The dashboard queries a single Region unless centralization/cross-account is configured.
2. Confirm the operator's **intent and scope**: single account vs. organization-wide, Standard
   vs. OCSF dashboard, and whether they also want S3 Tables/Athena querying enabled.
3. State the plan and the cost-bearing actions you may take (log ingestion, AWS Config service-
   linked recorder for enablement rules, dashboard). Get a go-ahead before Phase 2.

### Phase 1 — Validate prerequisites (read-only)
Detect whether the required data sources are already flowing to CloudWatch Logs as UDS facets:

```
aws logs list-aggregate-log-group-summaries --group-by DATA_SOURCE_NAME_AND_TYPE --region <REGION>
```

Look for `aws_cloudtrail` (type `management`, optionally `data`) and `amazon_vpc` (type `flow`).
- **Both present** → skip to Phase 3 (deploy).
- **Missing one or both** → go to Phase 2 to configure them.

Full detection logic, expected output shapes, and edge cases are in
[references/prerequisites-and-account-prep.md](references/prerequisites-and-account-prep.md).

### Phase 2 — Auto-configure missing data sources (state-changing — confirm first)
Enable only what is missing, preferring the managed, low-friction paths:
- **CloudTrail → CloudWatch** via CloudWatch telemetry enablement rule using a service-linked
  channel (no trail required), or by attaching CloudWatch Logs to an existing trail.
- **VPC Flow Logs → CloudWatch** via a telemetry enablement rule (`AWS::EC2::VPC`,
  `VPC_FLOW_LOGS`) so current and future VPCs are covered.

Commands, IAM, org-wide vs. account scope, and verification are in
[references/prerequisites-and-account-prep.md](references/prerequisites-and-account-prep.md).
After enabling, re-run the Phase 1 check and allow time for data to begin flowing.

### Phase 3 — Deploy the dashboard (state-changing — confirm stack name/params)
Deploy `assets/CloudWatch_Dashboard_CloudTrail_VPC.yaml` with CloudFormation, choosing
`LogFormat` = `Standard` or `OCSF` and a `DashboardName`. Then apply post-deployment hardening
(read-only IAM policy, stack termination protection). Full deploy + verify + hardening steps:
[references/deploy-security-dashboard.md](references/deploy-security-dashboard.md).

### Phase 4 — Verify and hand off
Confirm the stack reached `CREATE_COMPLETE`, the dashboard exists, and widgets return data.
Give the operator the dashboard URL, note that widgets populate as new events arrive, and offer
the querying and alarming follow-ups below.

## Routing — after (or instead of) deployment

| Operator need | Read |
|---|---|
| "Prepare my account and deploy the UDS" (full workflow) | Follow phases above + [prerequisites-and-account-prep.md](references/prerequisites-and-account-prep.md) + [deploy-security-dashboard.md](references/deploy-security-dashboard.md) |
| Understand UDS concepts: data sources, facets, OCSF, pipelines, S3 Tables | [uds-concepts.md](references/uds-concepts.md) |
| Validate/enable CloudTrail, VPC Flow Logs, other sources; facets/index policies | [prerequisites-and-account-prep.md](references/prerequisites-and-account-prep.md) |
| Deploy / update / clean up the dashboard stack; IAM hardening | [deploy-security-dashboard.md](references/deploy-security-dashboard.md) |
| Query/investigate with Logs Insights (SOURCE + filterIndex, facets) | [querying-logs-insights.md](references/querying-logs-insights.md) |
| Run SQL security analytics over UDS via S3 Tables + Athena | [querying-s3-tables-athena.md](references/querying-s3-tables-athena.md) |
| Centralize logs org-wide / cross-account / cross-Region for one pane | [cross-account-centralization.md](references/cross-account-centralization.md) |
| Add detective alarms/metric filters to complement the dashboard | [alarms-and-monitoring.md](references/alarms-and-monitoring.md) |
| Spans several areas | Read the most specific reference first, then others as needed |

## How the dashboard queries work (why it is portable)

Every widget query uses the same portable pattern — no log group names required:

```
SOURCE logGroups()
| filterIndex @data_source_type in ["management"]
| filterIndex @data_source_name in ["aws_cloudtrail"]
| <query logic>
```

- `SOURCE logGroups()` scopes the query across all Standard-class log groups in the account
  (and linked source accounts, in a monitoring account).
- `filterIndex @data_source_name` / `@data_source_type` use UDS **default facets** to narrow to
  just the log groups carrying that data source — CloudTrail is `aws_cloudtrail` (`management`
  or `data`); VPC Flow Logs are `amazon_vpc` (`flow`). These facets exist automatically on
  Standard log class log groups with no configuration.

This is why the same template works in any account regardless of how log groups are named.

## Files

| File | Content |
|------|---------|
| [assets/CloudWatch_Dashboard_CloudTrail_VPC.yaml](assets/CloudWatch_Dashboard_CloudTrail_VPC.yaml) | The CloudFormation template. Standard + OCSF dashboards, ~40 security widgets across 7 sections, gated by the `LogFormat` parameter. Read-only dashboard. |
| [references/uds-concepts.md](references/uds-concepts.md) | UDS architecture: data sources, default/custom facets, field indexes, OCSF/OTel normalization, pipelines, S3 Tables, cross-account. Security field maps (Standard ↔ OCSF). |
| [references/prerequisites-and-account-prep.md](references/prerequisites-and-account-prep.md) | Autonomous prerequisite detection + auto-enable CloudTrail/VPC Flow Logs (telemetry rules, SLC, trail attach), org-wide options, facet/index policies, IAM, verification. |
| [references/deploy-security-dashboard.md](references/deploy-security-dashboard.md) | Deploy/update/delete the stack, parameter choices, post-deploy hardening (read-only IAM, termination protection, SCPs), verification, troubleshooting empty widgets. |
| [references/querying-logs-insights.md](references/querying-logs-insights.md) | Logs Insights syntax for UDS (SOURCE, filterIndex, facets), plus a reusable security query library (CloudTrail + VPC Flow Logs, Standard and OCSF), incident-response playbook. |
| [references/querying-s3-tables-athena.md](references/querying-s3-tables-athena.md) | Enable the S3 Tables integration, register/grant access, and run SQL security analytics via Athena; correlation joins; retention/backfill behavior; security controls. |
| [references/cross-account-centralization.md](references/cross-account-centralization.md) | Cross-account observability vs. Logs centralization, org-wide telemetry rules, monitoring-account dashboards, when to use which. |
| [references/alarms-and-monitoring.md](references/alarms-and-monitoring.md) | Metric filters + alarms and Logs Insights query alarms for root usage, privilege escalation, console login failures, network REJECT spikes; SNS routing. |

## Guardrails

- **Read before write.** Always run the Phase 1 detection before enabling anything; never
  create trails/flow logs that already exist (managed enablement rules already skip duplicates).
- **Confirm cost/state changes.** Enabling data sources, the AWS Config service-linked recorder
  used by enablement rules, log ingestion, S3 Tables, and Athena queries incur charges. Name the
  action and get a go-ahead at the Phase 0/2/3 gates.
- **Least privilege on security data.** Apply the read-only dashboard IAM policy and treat all
  log/query data (IPs, ARNs, request params) as sensitive. Encrypt Athena output.
- **No backfill.** Newly enabled data sources and the S3 Tables integration only capture events
  going forward — tell the operator that widgets/tables populate over time, not retroactively.
- **Prefer managed paths.** Use telemetry enablement rules and service-linked channels over
  hand-built trails/flow logs so future resources are covered and drift is remediated.
