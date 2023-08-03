# Copyright 2022 Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
# Licensed under the Amazon Software License  http://aws.amazon.com/asl/

import boto3
import os
import json
import logging
import traceback

from botocore.exceptions import ClientError

import aws_utils.ssm as ssm
import aws_utils.r53 as r53
import aws_utils.ec2 as ec2
import config.reverseProxy as config

logger = logging.getLogger()
logger.setLevel(logging.INFO)

autoscaling = boto3.client("autoscaling")

ARTIFACTS_BUCKET = os.environ["ARTIFACTS_BUCKET"]
NUCLEUS_ROOT_DOMAIN = os.environ["NUCLEUS_ROOT_DOMAIN"]
NUCLEUS_DOMAIN_PREFIX = os.environ["NUCLEUS_DOMAIN_PREFIX"]
NUCLEUS_SERVER_ADDRESS = os.environ["NUCLEUS_SERVER_ADDRESS"]


def send_lifecycle_action(event, result):
    try:
        response = autoscaling.complete_lifecycle_action(
            LifecycleHookName=event["detail"]["LifecycleHookName"],
            AutoScalingGroupName=event["detail"]["AutoScalingGroupName"],
            LifecycleActionToken=event["detail"]["LifecycleActionToken"],
            LifecycleActionResult=result,
            InstanceId=event["detail"]["EC2InstanceId"],
        )

        logger.info(response)
    except ClientError as e:
        message = "Error completing lifecycle action: {}".format(e)
        logger.error(message)
        raise Exception(message)

    return


def update_nginix_config(
    instanceId, artifactsBucket, nucleusServerAddress, domain
):
    # generate config for reverse proxy servers
    commands = []
    try:
        commands = config.get_config(
            artifactsBucket, nucleusServerAddress, domain)
        logger.debug(commands)
    except Exception as e:
        raise Exception("Failed to get Reverse Proxy config. {}".format(e))

    response = ssm.run_commands(
        instanceId, commands, document="AWS-RunShellScript"
    )
    return response


def handler(event, context):

    logger.info("Event: %s", json.dumps(event, indent=2))

    instanceId = event["detail"]["EC2InstanceId"]
    transition = event["detail"]["LifecycleTransition"]

    if transition == "autoscaling:EC2_INSTANCE_LAUNCHING":
        try:
            update_nginix_config(
                instanceId,
                ARTIFACTS_BUCKET,
                NUCLEUS_SERVER_ADDRESS,
                f"{NUCLEUS_DOMAIN_PREFIX}.{NUCLEUS_ROOT_DOMAIN}",
            )

            send_lifecycle_action(event, "CONTINUE")

        except Exception as e:

            message = "Error running command: {}".format(e)
            logger.warning(traceback.format_exc())
            logger.error(message)
            send_lifecycle_action(event, "ABANDON")

    elif transition == "autoscaling:EC2_INSTANCE_TERMINATING":

        try:
            send_lifecycle_action(event, "CONTINUE")

        except Exception as e:

            message = "Error running command: {}".format(e)
            logger.warning(traceback.format_exc())
            logger.error(message)
            send_lifecycle_action(event, "ABANDON")

    logger.info("Execution Complete")

    return
