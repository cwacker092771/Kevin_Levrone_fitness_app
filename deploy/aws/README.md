# Deploying to AWS (EC2 + RDS)

`cloudformation.yaml` stands up:

- one **EC2** instance (Amazon Linux 2023) running the Node app under `systemd`,
  with **Caddy** in front as a reverse proxy (automatic HTTPS when you give it a
  domain);
- one **RDS PostgreSQL 16** instance, private, reachable only from the EC2
  security group;
- the security groups, IAM instance profile (for SSM Session Manager), and RDS
  subnet group to tie them together.

It deploys **into a VPC you already have** — it does not create a VPC.

---

## Prerequisites

1. **Push this repo to a public git host.** The instance clones it over HTTPS at
   first boot. Commit everything first — there are currently untracked files
   (`db/auth.js`, `db/licenses.js`, `lib/licenseTiers.js`, `lib/passwordPolicy.js`,
   `lib/session.js`) that the app needs:
   ```
   git add -A && git commit -m "…" && git push
   ```
   Note the clone URL, e.g. `https://github.com/<you>/<repo>.git`.
2. **A VPC with two public subnets** in different AZs (public = has a route to an
   internet gateway). The default VPC works. Note the VPC id and two subnet ids.
3. AWS CLI configured with credentials that can create EC2/RDS/IAM resources.
4. *(Optional)* an **EC2 key pair** in the target region if you want SSH. Leave
   `KeyName` unset to rely on SSM Session Manager only (no port 22 opened).
5. *(Optional)* a **domain name** you can point at the instance. Without one the
   app is served over plain HTTP (see "Cookies & HTTPS" below).

---

## Deploy

```bash
aws cloudformation deploy \
  --stack-name levrone-protocol \
  --template-file deploy/aws/cloudformation.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
      VpcId=vpc-xxxxxxxx \
      SubnetIds=subnet-aaaa,subnet-bbbb \
      RepoUrl=https://github.com/<you>/<repo>.git \
      RepoBranch=main \
      DBPassword='choose-a-strong-one' \
      Domain=fitness.example.com
```

- Omit `Domain=…` to skip HTTPS and serve on port 80.
- Add `KeyName=my-keypair SSHLocation=203.0.113.4/32` to enable SSH; otherwise
  use `aws ssm start-session` (the `SSMSessionCommand` stack output).
- Add `WebAccessCidr=your.ip/32` to restrict ports 80/443 to a single address
  (default is open to the world). If also issuing a Let's Encrypt cert, keep
  port 80 open until the cert is issued.
- `SubnetIds` is a single comma-separated value (no spaces).
- RDS takes ~5–10 minutes; the stack finishes when the instance is up, the app
  may still be installing for a minute after that.

Get the URL and other outputs:

```bash
aws cloudformation describe-stacks --stack-name levrone-protocol \
  --query 'Stacks[0].Outputs' --output table
```

Then, if you set a domain, create a DNS **A record** for it pointing at
`InstancePublicIP`. Caddy issues the certificate automatically on the first
request once DNS resolves.

---

## Security notes (the "plain" tradeoffs)

- `DBPassword` is a `NoEcho` stack parameter. It is written into the instance
  **UserData** and into `/opt/levrone/app.env` in plaintext, so anyone who can
  call `aws ec2 describe-instance-attribute --attribute userData` or read files
  on the box can see it. For a hardened setup, store it in **Secrets Manager**
  and have the instance fetch it at boot instead.
- SSH defaults to `0.0.0.0/0` — set `SSHLocation` to your `/32`, or rely on
  Session Manager and remove the port 22 rule.
- The instance has a public IP. There is no WAF or rate limiting in front of it.

## Cookies & HTTPS

Session cookies are marked `Secure` in production, so **login only works over
HTTPS**. The template handles this for you:

- **With `Domain`** → Caddy serves HTTPS, app runs `NODE_ENV=production`.
- **Without `Domain`** → the instance writes `COOKIE_SECURE=false` to the env
  file so the cookie is still returned over plain HTTP. Use this for a quick
  test only; move to a domain before real use.

---

## Verifying / troubleshooting

Open a shell without SSH:

```bash
aws ssm start-session --target <instance-id>   # from the SSMSessionCommand output
```

On the instance:

```bash
sudo cat /var/log/cloud-init-output.log     # first-boot script output
sudo systemctl status levrone caddy
sudo journalctl -u levrone -n 100 --no-pager
curl -s localhost:3000/healthz              # {"status":"ok"} when the DB is reachable
```

Common issues:

| Symptom | Cause / fix |
| --- | --- |
| `healthz` returns 503 | App can't reach RDS. Check the DB security group allows the web SG on 5432, and that `DATABASE_URL` in `/opt/levrone/app.env` has the right endpoint. |
| `git clone` failed in cloud-init log | `RepoUrl` isn't publicly reachable, or the branch doesn't exist. |
| `dnf install nodejs20` failed | On older AL2023 AMIs use NodeSource: `curl -fsSL https://rpm.nodesource.com/setup_20.x | sudo bash - && sudo dnf install -y nodejs`, then `sudo systemctl restart levrone`. |
| HTTPS cert not issued | DNS A record not pointing at the instance yet, or port 80/443 blocked. Caddy retries; check `journalctl -u caddy`. |

---

## Redeploying new code

Push to your branch, then on the instance:

```bash
sudo /opt/levrone/app/deploy/aws/redeploy.sh main
```

`schema.sql` is idempotent and re-runs on every app start, so schema changes
apply automatically on restart.

---

## Updating infrastructure

Re-run the same `aws cloudformation deploy` command with changed
`--parameter-overrides`. Changing `InstanceType` replaces the instance (and
re-runs first-boot). Changing most DB properties updates in place; some force a
replacement — CloudFormation will tell you in the change set.

---

## Cost (us-east-1, rough, on-demand)

| Resource | Monthly |
| --- | --- |
| `t3.small` EC2 | ~$15 |
| `db.t4g.micro` RDS + 20 GB gp3 | ~$14 |
| EBS 8 GB gp3, public IPv4, backups | ~$4 |
| **Total** | **~$33** |

Drop to `t3.micro` / keep within the RDS free tier (`db.t3.micro`, first 12
months) to reduce this.

---

## Teardown

```bash
aws cloudformation delete-stack --stack-name levrone-protocol
```

The RDS instance has `DeletionPolicy: Snapshot` — a final snapshot is kept (and
bills a few cents/month) unless you delete it manually afterwards.
