# Detective Alarms to Complement the Dashboard

The dashboard shows what is happening; it does not notify you. Add alarms so critical security
events page someone. Two complementary approaches over the same UDS data.

## Approach A — metric filters + metric alarms (classic, per log group)

Metric filters run on a specific log group and emit a CloudWatch metric you alarm on. Good for
well-known CloudTrail patterns. (Metric filters target a named log group, so point them at the
CloudTrail/UDS log group — discover it from the Phase 1 detection.)

Common security filter patterns (CloudTrail JSON):

| Detection | Filter pattern |
|---|---|
| Root account usage | `{ $.userIdentity.type = "Root" && $.userIdentity.invokedBy NOT EXISTS && $.eventType != "AwsServiceEvent" }` |
| Privilege escalation | `{ ($.eventName = "AttachRolePolicy") \|\| ($.eventName = "PutRolePolicy") \|\| ($.eventName = "CreateAccessKey") \|\| ($.eventName = "CreateLoginProfile") }` |
| Console login failure | `{ ($.eventName = "ConsoleLogin") && ($.errorMessage = "Failed authentication") }` |
| IAM policy changes | `{ ($.eventName = "DeleteUserPolicy") \|\| ($.eventName = "PutUserPolicy") \|\| ($.eventName = "AttachUserPolicy") }` |
| MFA disabled | `{ ($.eventName = "DeactivateMFADevice") \|\| ($.eventName = "DeleteVirtualMFADevice") }` |

Create filter + alarm:
```
aws logs put-metric-filter \
  --log-group-name <CLOUDTRAIL_LOG_GROUP> \
  --filter-name RootAccountUsage \
  --filter-pattern '{ $.userIdentity.type = "Root" && $.userIdentity.invokedBy NOT EXISTS && $.eventType != "AwsServiceEvent" }' \
  --metric-transformations metricName=RootAccountUsage,metricNamespace=SecurityMetrics,metricValue=1,defaultValue=0 \
  --region <REGION>

aws cloudwatch put-metric-alarm \
  --alarm-name RootAccountUsageAlarm \
  --namespace SecurityMetrics --metric-name RootAccountUsage \
  --statistic Sum --period 300 --evaluation-periods 1 \
  --threshold 1 --comparison-operator GreaterThanOrEqualToThreshold \
  --treat-missing-data notBreaching \
  --alarm-actions <SNS_TOPIC_ARN> \
  --region <REGION>
```

## Approach B — Logs Insights query alarms (facet-scoped, portable)

Alarm directly on a Logs Insights / Metrics Insights query so you don't depend on a specific log
group name — mirrors the dashboard's portability. Ideal for network-layer detections like a
REJECT spike (port scanning / active attack) over a rolling window:

```
SOURCE logGroups() | filterIndex @data_source_name in ["amazon_vpc"]
| filter action = "REJECT" | stats count(*) as rejects by bin(5m)
```
Create a query-based alarm on the resulting count and set a threshold that fits your baseline.
Use the same approach for a CloudTrail error-rate spike (`filter ispresent(errorCode)`), external
API-error concentration, or repeated console-login failures.

## Route notifications

Send alarm actions to an SNS topic that fans out to email/Slack/PagerDuty/your incident platform:
```
aws sns create-topic --name security-alarms --region <REGION>
aws sns subscribe --topic-arn <SNS_TOPIC_ARN> --protocol email --notification-endpoint <EMAIL> --region <REGION>
```
For notification setup and encrypted SNS/topic policies, see the
`setting-up-cloudwatch-alarm-notifications` skill.

## Suggested starter set

Root usage, privilege escalation, console-login failures, MFA disable, and a VPC REJECT-spike
query alarm. Tune thresholds to each account's baseline (use the dashboard's timelines to gauge
normal), and prefer `treat-missing-data notBreaching` for rare-event alarms.

## References

- [Alarms that send email](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/AlarmThatSendsEmail.html)
- [CloudWatch Logs metric filters](https://docs.aws.amazon.com/AmazonCloudWatch/latest/logs/MonitoringLogData.html)
- [Logs Insights query alarm](https://docs.aws.amazon.com/AmazonCloudWatch/latest/monitoring/Create_Metrics_Insights_Alarm.html)
- Related skills: `setting-up-cloudwatch-alarm-notifications`, `aws-observability` (alarms.md)
