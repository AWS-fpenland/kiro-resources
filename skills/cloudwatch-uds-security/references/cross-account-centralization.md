# Cross-Account & Cross-Region UDS (Org-wide Security Visibility)

To give the dashboard and queries a single pane across an AWS Organization, combine UDS with one
of two centralization models. Both enrich records with `@aws.account` and `@aws.region` so you
can group by account/Region in the dashboard widgets and queries.

## Two models — pick based on whether you copy data

| Model | What it does | Use when |
|---|---|---|
| **Cross-account observability** | A **monitoring account** queries logs **in place** in linked source accounts — no data copy. `SOURCE logGroups()` and the dashboard span linked accounts. | You want a single query/dashboard pane with least data movement; per-account retention stays local. |
| **Logs centralization** | **Replicates** log data from source accounts/Regions into a **destination account** (optional backup Region) via centralization rules. | You need a durable central copy (SIEM feed, DR, cross-Region resilience), or want same-named log groups merged centrally. |

They can be combined: centralize into a destination account, then use that account as a
monitoring account for cross-account queries.

## Cross-account observability (in-place)

- Set up a **monitoring account** and link **source accounts** (CloudWatch cross-account
  observability). Then `SOURCE logGroups()` in the monitoring account spans all linked accounts;
  add `accountIdentifier` in `SOURCE` (≤20) to target specific ones.
- Deploy the dashboard **in the monitoring account** to see all linked accounts at once (widgets
  already group by `recipientAccountId`/`cloud.account.uid` and `awsRegion`/`cloud.region`).
- Caveat: facet **panels** in the console reflect only logs ingested in the local (monitoring)
  account, but **queries still return** source-account results.

## Logs centralization (replicate)

Run from the **management or delegated-admin** account. Key concepts:
- **Centralization rule** — defines source scope (Organization / OU / accounts), source Regions,
  destination account+Region, optional **backup Region**, and log-group selection.
- **Log-group selection** supports `LogGroupName | *` with `= != IN NOT IN AND OR LIKE NOT LIKE`.
- **Same-named log groups merge** in the destination; source context is preserved via
  `@aws.account` / `@aws.region`.
- **Encryption/KMS:** data is encrypted in transit (AWS owned key) and at rest with your chosen
  method. For customer-managed KMS in the destination, tag the key `LogsManaged = true` so the
  centralization service can use it. Source-account CMKs need CloudWatch Logs decrypt permission
  for throughput buffering and data-protection/redaction scenarios.

Console path: CloudWatch → **Settings** → **Organization** → **Configure rule** → specify source,
destination (+ optional backup Region), and telemetry/log-group filters.

## Org-wide data source enablement (feeds both models)

Ensure every account is actually producing the UDS security sources by using **organization
telemetry enablement rules** (management/delegated-admin account):
```
aws observabilityadmin create-telemetry-rule-for-organization \
  --rule-name org-cloudtrail-management \
  --rule '{ "ResourceType":"AWS::CloudTrail::Trail", "TelemetryType":"Logs",
            "TelemetrySourceTypes":["CLOUDTRAIL_MANAGEMENT_EVENTS"],
            "DestinationConfiguration":{"DestinationType":"Amazon CloudWatch Logs","RetentionInDays":90} }' \
  --region <REGION>
```
- Org-level rules set the **baseline**; OU/account rules can add coverage but not reduce it —
  conflicting rules cause none to apply, so keep the hierarchy clean.
- Use **Target regions** to replicate a rule; the current Region is the home Region and spoke
  copies are read-only there. Discovery via the AWS Config service-linked recorder can take up to
  ~24h initially. Do the same for `AWS::EC2::VPC` / `VPC_FLOW_LOGS` and any other sources.

## Putting it together for the dashboard

1. Org telemetry rules → every account produces `aws_cloudtrail` + `amazon_vpc`.
2. Cross-account observability (or centralization) → one account can see all of it.
3. Deploy the dashboard in that account → org-wide security visibility, grouped by account/Region.

## References

- [Cross-account cross-Region log centralization](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/CloudWatchLogs_Centralization.html)
- [CloudWatch cross-account observability](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch-Unified-Cross-Account.html)
- [create-telemetry-rule-for-organization (CLI)](https://docs.aws.amazon.com/cli/latest/reference/observabilityadmin/create-telemetry-rule-for-organization.html)
