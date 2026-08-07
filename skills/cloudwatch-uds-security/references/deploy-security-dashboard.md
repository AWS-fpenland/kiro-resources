# Deploy the UDS Security Visibility Dashboard

Deploys `assets/CloudWatch_Dashboard_CloudTrail_VPC.yaml` — a CloudFormation template that
creates a **read-only** CloudWatch dashboard for CloudTrail API activity and VPC Flow Logs
network activity, using UDS default facets so it is portable across accounts. This is Phase 3–4
of the deployment workflow. Do not deploy until Phase 1 confirms the data sources exist
(see [prerequisites-and-account-prep.md](prerequisites-and-account-prep.md)).

## What the template creates

- A single `AWS::CloudWatch::Dashboard` resource (either `SecurityDashboardStandard` or
  `SecurityDashboardOCSF`, gated by the `LogFormat` parameter/conditions).
- ~40 widgets across 7 sections: Security Overview, Correlated Insights (CloudTrail + VPC),
  Network Security, IAM & Access, Activity Distribution, Detailed Events Timeline, MFA & S3/
  exfiltration indicators, and summary counters.
- No log groups, no IAM roles, no data — just the dashboard. It reads existing UDS data.

Every widget query follows the portable pattern:
```
SOURCE logGroups() | filterIndex @data_source_type in ["management"] | filterIndex @data_source_name in ["aws_cloudtrail"] | ...
```
(VPC widgets use `@data_source_type in ["flow"]` and `@data_source_name in ["amazon_vpc"]`.)

## Parameters

| Parameter | Default | Choose |
|---|---|---|
| `DashboardName` | `CloudTrail-VPC-Dashboard` | Alphanumeric, `-`, `_`, 1–255 chars. Also used as the stack name below for a clean 1:1 mapping. |
| `LogFormat` | `Standard` | `Standard` for native AWS fields; `OCSF` only if your CloudTrail/VPC logs are OCSF-normalized in UDS (see prerequisites 2c). |

Pick `OCSF` only when OCSF conversion is actually configured — otherwise the OCSF widgets query
fields (`api.operation`, `src_endpoint.ip`, `status_id`, …) that won't exist and will render
empty. When unsure, use `Standard`.

## Deploy

Use the AWS MCP server or CLI. Prefer `deploy` (create-or-update, idempotent):

```
aws cloudformation deploy \
  --template-file assets/CloudWatch_Dashboard_CloudTrail_VPC.yaml \
  --stack-name CloudTrail-VPC-Dashboard \
  --parameter-overrides DashboardName=CloudTrail-VPC-Dashboard LogFormat=Standard \
  --region <REGION>
```

Equivalent explicit create:
```
aws cloudformation create-stack \
  --stack-name CloudTrail-VPC-Dashboard \
  --template-body file://assets/CloudWatch_Dashboard_CloudTrail_VPC.yaml \
  --parameters ParameterKey=DashboardName,ParameterValue=CloudTrail-VPC-Dashboard \
               ParameterKey=LogFormat,ParameterValue=Standard \
  --region <REGION>
```

Validate the template first if editing it:
```
aws cloudformation validate-template --template-body file://assets/CloudWatch_Dashboard_CloudTrail_VPC.yaml --region <REGION>
```

## Verify (Phase 4)

```
aws cloudformation describe-stacks --stack-name CloudTrail-VPC-Dashboard \
  --query "Stacks[0].StackStatus" --region <REGION>          # expect CREATE_COMPLETE / UPDATE_COMPLETE
aws cloudwatch get-dashboard --dashboard-name CloudTrail-VPC-Dashboard --region <REGION>
```
Dashboard URL:
`https://<REGION>.console.aws.amazon.com/cloudwatch/home?region=<REGION>#dashboards/dashboard/<DashboardName>`

Widgets populate as new events arrive (no backfill). If a fresh account shows empty widgets,
generate some activity (an API call, a console login, network traffic) and refresh.

## Post-deployment hardening (recommended)

1. **Enable stack termination protection** to prevent accidental deletion:
   ```
   aws cloudformation update-termination-protection \
     --stack-name CloudTrail-VPC-Dashboard --enable-termination-protection --region <REGION>
   ```
2. **Apply least-privilege dashboard IAM.** The dashboard surfaces security data — grant view-
   only broadly and restrict modification. Attach to viewer roles/groups:
   ```json
   {
     "Version": "2012-10-17",
     "Statement": [
       { "Sid": "AllowDashboardReadOnly", "Effect": "Allow",
         "Action": ["cloudwatch:GetDashboard","cloudwatch:ListDashboards"],
         "Resource": "arn:aws:cloudwatch::<ACCOUNT_ID>:dashboard/CloudTrail-VPC-Dashboard" },
       { "Sid": "DenyDashboardModification", "Effect": "Deny",
         "Action": ["cloudwatch:PutDashboard","cloudwatch:DeleteDashboards"],
         "Resource": "arn:aws:cloudwatch::<ACCOUNT_ID>:dashboard/CloudTrail-VPC-Dashboard" }
     ]
   }
   ```
   The queries themselves also require `logs:StartQuery`, `logs:GetQueryResults`, and
   `logs:FilterLogEvents` on the CloudTrail/VPC log groups for viewers.
3. **Restrict who can modify dashboards org-wide** with an SCP denying `cloudwatch:PutDashboard`
   / `cloudwatch:DeleteDashboards` except for admin roles.
4. **Audit dashboard changes** — CloudTrail logs `PutDashboard`/`DeleteDashboards`; these show
   up in the dashboard's own IAM/API widgets.

## Update / clean up

Update (e.g., switch format or rename): re-run `deploy` with new `--parameter-overrides`. Note:
changing `LogFormat` swaps which conditional resource is active, replacing the dashboard body.

Delete (disable termination protection first if enabled):
```
aws cloudformation update-termination-protection --stack-name CloudTrail-VPC-Dashboard \
  --no-enable-termination-protection --region <REGION>
aws cloudformation delete-stack --stack-name CloudTrail-VPC-Dashboard --region <REGION>
```

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| All widgets empty | Data sources not present / no new events since enablement | Re-run the Phase 1 detection; confirm `aws_cloudtrail` + `amazon_vpc`; generate activity (no backfill) |
| Only CloudTrail (or only VPC) widgets empty | That source not flowing to CloudWatch Logs | Enable it (prerequisites 2a/2b) |
| OCSF widgets empty but data exists | Logs are native, not OCSF | Redeploy with `LogFormat=Standard`, or configure OCSF conversion |
| Widgets error on `filterIndex`/`SOURCE` | Log groups are Infrequent Access, not Standard class | UDS facets/`filterIndex` require Standard log class |
| `ValidationError` on deploy | Template edited/invalid | `validate-template`; check `DashboardName` pattern (alphanumeric/`-`/`_`) |
| Missing cross-account data | Not in a monitoring account | See [cross-account-centralization.md](cross-account-centralization.md) |

## References

- [Guide: Security Visibility Dashboard using UDS](https://aws-samples.github.io/cloud-operations-best-practices/docs/solutions/AWS%20CloudTrail/security-dashboard-uds/)
- [CloudWatch Dashboards](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/CloudWatch_Dashboards.html)
- Template: [assets/CloudWatch_Dashboard_CloudTrail_VPC.yaml](../assets/CloudWatch_Dashboard_CloudTrail_VPC.yaml)
