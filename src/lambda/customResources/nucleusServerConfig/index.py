# Copyright 2022 Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
# Licensed under the Amazon Software License  http://aws.amazon.com/asl/

import os
import logging
import json


import boto3
from crhelper import CfnResource

import aws_utils.ssm as ssm
import aws_utils.sm as sm

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
logger = logging.getLogger()
logger.setLevel(LOG_LEVEL)

helper = CfnResource(json_logging=False, log_level="DEBUG",
                     boto_level="CRITICAL")


@helper.create
def create(event, context):
    logger.info("Create Event: %s", json.dumps(event, indent=2))

    nucluesServerAddress = event["ResourceProperties"]["nucluesServerAddress"]
    instanceId = event["ResourceProperties"]["instanceId"]
    reverseProxyDomain = event["ResourceProperties"]["reverseProxyDomain"]
    artifactsBucket = event["ResourceProperties"]["artifactsBucket"]
    nucleusBuild = event["ResourceProperties"]["nucleusBuild"]
    ovMainLoginSecretArn = event["ResourceProperties"]["ovMainLoginSecretArn"]
    ovServiceLoginSecretArn = event["ResourceProperties"]["ovServiceLoginSecretArn"]

    response = update_nucleus_config(
        instanceId,
        artifactsBucket,
        nucluesServerAddress,
        reverseProxyDomain,
        nucleusBuild,
        ovMainLoginSecretArn,
        ovServiceLoginSecretArn,
    )
    logger.info("Run Command Results: %s", json.dumps(response, indent=2))


@helper.update
def update(event, context):
    logger.info("Update Event: %s", json.dumps(event, indent=2))

    nucleusServerAddress = event["ResourceProperties"]["nucleusServerAddress"]
    instanceId = event["ResourceProperties"]["instanceId"]
    reverseProxyDomain = event["ResourceProperties"]["reverseProxyDomain"]
    artifactsBucket = event["ResourceProperties"]["artifactsBucket"]
    nucleusBuild = event["ResourceProperties"]["nucleusBuild"]
    ovMainLoginSecretArn = event["ResourceProperties"]["ovMainLoginSecretArn"]
    ovServiceLoginSecretArn = event["ResourceProperties"]["ovServiceLoginSecretArn"]

    response = update_nucleus_config(
        instanceId,
        artifactsBucket,
        nucleusServerAddress,
        reverseProxyDomain,
        nucleusBuild,
        ovMainLoginSecretArn,
        ovServiceLoginSecretArn,
    )
    logger.info("Run Command Results: %s", json.dumps(response, indent=2))


def update_nucleus_config(
    instanceId,
    artifactsBucket,
    nucleusServerAddress,
    reverseProxyDomain,
    nucleusBuild,
    ovMainLoginSecretArn,
    ovServiceLoginSecretArn,
):

    ovMainLoginSecret = sm.get_secret(ovMainLoginSecretArn)
    ovServiceLoginSecret = sm.get_secret(ovServiceLoginSecretArn)
    ovMainLoginPassword = ovMainLoginSecret["password"]
    ovServiceLoginPassword = ovServiceLoginSecret["password"]

    commands = [
        # install Nucleus Server Tools (nst) packaged from src/tools
        "pwd",
        f"aws s3 cp s3://{artifactsBucket}/tools/tools.zip ./tools.zip",
        "unzip -o tools.zip",
        "cd nucleusServer",
        "pip3 install -r requirements.txt",
        # unpackage nucleus stack
        "omniverse_root=opt/ove/",
        "sudo mkdir -p $omniverse_root",
        f"sudo tar xzvf stack/{nucleusBuild}.tar.gz -C $omniverse_root --strip-components=1",
        "cd opt/ove/base_stack",
        f"nst generate-nucleus-stack-env  \
            --server-ip {nucleusServerAddress} \
            --reverse-proxy-domain {reverseProxyDomain} \
            --instance-name nucleus_server \
            --master-password {ovMainLoginPassword} \
            --service-password {ovServiceLoginPassword} \
            --data-root /var/lib/omni/nucleus-data",
        "chmod +x ./generate-sample-insecure-secrets.sh",
        "./generate-sample-insecure-secrets.sh",
        # pull the images
        "docker-compose --env-file nucleus-stack.env -f nucleus-stack-ssl.yml pull",
        # start the nucleus stack
        "docker-compose --env-file nucleus-stack.env -f nucleus-stack-ssl.yml up -d",
        # review with sudo docker ps -a
    ]

    for p in commands:
        print(p)

    response = ssm.run_commands(
        instanceId, commands, document="AWS-RunShellScript")
    return response


@helper.delete
def delete(event, context):
    logger.info("Delete Event: %s", json.dumps(event, indent=2))


def handler(event, context):
    helper(event, context)
