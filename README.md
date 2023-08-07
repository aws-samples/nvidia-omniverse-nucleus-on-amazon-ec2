# NVIDIA Omniverse Nucleus on Amazon EC2
NVIDIA Omniverse is a scalable, multi-GPU, real-time platform for building and operating metaverse applications, based on Pixar's Universal Scene Description (USD) and NVIDIA RTX technology. USD is a powerful, extensible 3D framework and ecosystem that enables 3D designers and developers to connect and collaborate between industry-leading 3D content creation, rendering, and simulation applications. Omniverse helps individual creators to connect and enhance their 3D artistic process, and enterprises to build and simulate large scale virtual worlds for industrial applications.

With Omniverse, everyone involved in the lifecycle of 3D data has access to high-quality visualizations, authoring, and review tools. Teams do not need additional overhead to manage complex 3D data pipelines. Instead, they can focus on their unique contributions to bring value to the market. Non-technical stakeholders do not need to subject themselves to applications with steep learning curves, nor do results need to be compromised for the sake of iteration reviews. 

To support distributed Omniverse users, Nucleus should be deployed in a secure environment. With on-demand compute, storage, and networking resources, AWS infrastructure is well suited to all spatial computing workloads, including Omniverse Nucleus. This repository provides the steps and infrastructure for an Omniverse Enterprise Nucleus Server deployment on Amazon EC2.



## Contents
* [Prerequisites](#prerequisites)
* [Deployment](#deployment)
* [Architecture](#architecture)
* [Troubleshooting](#troubleshooting)
* [Getting Help](#getting-help)
* [Changelog](#changelog)
* [Security](#security)
* [License](#license)
* [References](#references)

## Prerequisites
- AWS CLI - https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html
- AWS CDK - https://docs.aws.amazon.com/cdk/v2/guide/getting_started.html#getting_started_install
- Docker - https://www.docker.com/products/docker-desktop/
- Python 3.9 or greater - https://www.python.org
- Access to NVIDIA Enterprise Omniverse Nucleus packages - https://docs.omniverse.nvidia.com/prod_nucleus/prod_nucleus/enterprise/installation/quick_start_tips.html
- A Route53 Public Hosted Zone - https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/CreatingHostedZone.html

**To learn more, reference the official documentation from NVIDIA:** https://docs.omniverse.nvidia.com/prod_nucleus/prod_nucleus/enterprise/cloud_aws_ec2.html

## Architecture
![architecture](/diagrams/architecture.png)

## Deployment
### 1. Download Nucleus Deployment Artifacts from NVIDIA
Place them in `./src/tools/nucleusServer/stack`

For example: `./src/tools/nucleusServer/stack/nucleus-stack-2023.1.0+tag-2023.1.0.gitlab.8633670.7f07353a.tar.gz`

Consult NVIDIA documentation to find the appropriate packages.

> Note This deployment has a templated copy of `nucleus-stack.env` located at `./src/tools/nucleusServer/templates/nucleus-stack.env` this may need to be updated if NVIDIA makes changes to the `nucleus-stack.env` file packaged with their archive.
>
> The same applies to NVIDIA's reverse proxy `nginx.conf` located at `./src/tools/reverseProxy/templates/nginx.conf`

### 2. configure .env file
create ./.env

Set the following variables
```
  export APP_STACK_NAME=omni-app
  export AWS_DEFAULT_REGION=us-west-2

  # STACK INPUTS
  export OMNIVERSE_ARTIFACTS_BUCKETNAME=example-bucket-name
  export ROOT_DOMAIN=example-domain.com
  export NUCLEUS_SERVER_PREFIX=nucleus
  export NUCLEUS_BUILD=nucleus-stack-2023.1.0+tag-2023.1.0.gitlab.8633670.7f07353a # from Step 1
  export ALLOWED_CIDR_RANGE_01=cidr-range-with-public-access
  export DEV_MODE=true
```

> NOTE: This deployment assumes you have a public hosted zone in Route53 for the ROOT_DOMAIN, this deployment will add a CNAME record to that hosted zone

### 3. Run the deployment
The following script will run cdk deploy. The calling process must be authenticated with sufficient permissions to deploy AWS resources.

```
chmod +x ./deploy.sh
./deploy.sh
```
> NOTE: deployment requires a running docker session for building Python Lambda functions

> NOTE: It can take a few minutes for the instances to get up and running. After the deployment script finishes, review your EC2 instances and check that they are in a running state.

### 4. Test the connection
Test a connection to `<NUCLEUS_SERVER_PREFIX>.<ROOT_DOMAIN>` from within the ALLOWED_CIDR_RANGE set in the `.env` file. Do so by browsing to `https://<NUCLUES_SERVER_PREFIX>.<ROOT_DOMAIN>` in your web browser.

The default admin username for the Nucleus server is 'omniverse'. You can find the password in a Secrets Manager resource via the AWS Secrets Manager Console. Alternatively, from the Omniverse WebUI, you can create a new username and password.

## Troubleshooting
### Unable to connect to the Nucleus Server
If you are not able to connect to to the Nucleus server, review the status of the Nginx service, and the Nucleus docker stack. To do so, connect to your instances from the EC2 Console via Session Manager - https://docs.aws.amazon.com/AWSEC2/latest/UserGuide/session-manager.html.

- On the Nginx Server, run `sudo journalctl -u nginx.service`, if this is produces no output the Nginx service is not running.

- On the Nucleus server, run `sudo docker ps`, you should see a list of Nucleus containers up.

If there are issues with either of these, it is likely there was an issue with the Lambda and/or SSM run commands that configure the instances. Browse to the Lambda Console (https://us-west-2.console.aws.amazon.com/lambda/home?region=us-west-2#/functions) and search for the respective Lambda Functions:
- STACK_NAME-ReverseProxyConfig-CustomResource
- STACK_NAME-NucleusServerConfig-CustomResource

Review the function CloudWatch Logs.
​
### No service log entries, or unable to restart nitro-enclave service
If there are issues with either of these, it is likely there was an issue with the Lambda and/or SSM run commands that configure the instances. Browse to the Lambda Console and search for the `STACK_NAME-ReverseProxyConfig-CustomResource` Lambda Function, then review the CloudWatch Logs.

At times the Reverse Proxy custom resource Lambda function does not trigger on a initial stack deployment. If the reverse proxy instance is in a running state, but there are now invocations/logs, terminate the instance and give the auto scaling group a few minutes to create another one, and then try again. Afterwards, check the CloudWatch Logs for the Lambda function: `ReverseProxyAutoScalingLifecycleLambdaFunction`

### Additional Nginx Commands
View Nitro Enclaves Service Logs:

`sudo journalctl -u nginx.service`

Viewing Nginx Logs

`sudo cat /var/log/nginx/error.log`

`sudo cat /var/log/nginx/access.log`

Restart Nginx

`systemctl restart nginx.service`

### Additional Nucleus server notes
Review NVIDIA's Documentation - https://docs.omniverse.nvidia.com/prod_nucleus/prod_nucleus/enterprise/installation/quick_start_tips.html

default base stack and config location: `/opt/ove/`

default omniverse data dir: `/var/lib/omni/nucleus-data`

Interacting with the Nucleus Server docker compose stack:

`sudo docker-compose --env-file ./nucleus-stack.env -f ./nucleus-stack-ssl.yml pull`

`sudo docker-compose --env-file ./nucleus-stack.env -f ./nucleus-stack-ssl.yml up -d`

`sudo docker-compose --env-file ./nucleus-stack.env -f ./nucleus-stack-ssl.yml down`

`sudo docker-compose --env-file ./nucleus-stack.env -f ./nucleus-stack-ssl.yml ps`

Generate new secrets

`sudo rm -fr secrets && sudo ./generate-sample-insecure-secrets.sh`

## Getting Help
If you have questions as you explore this sample project, post them to the Issues section of this repository. To report bugs, request new features, or contribute to this open source project, see [CONTRIBUTING.md](./CONTRIBUTING.md).

## Changelog
To view the history and recent changes to this repository, see [CHANGELOG.md](./CHANGELOG.md)

## Security
See [CONTRIBUTING](./CONTRIBUTING.md) for more information.

## License
This sample code is licensed under the MIT-0 License. See the [LICENSE](./LICENSE) file.

## References
### NVIDIA Omniverse
[Learn more about the NVIDIA Omniverse Platform](https://www.nvidia.com/en-us/omniverse/)

### Omniverse Nucleus
[Learn more about the NVIDIA Omniverse Nucleus](https://docs.omniverse.nvidia.com/prod_nucleus/prod_nucleus/overview.html)


