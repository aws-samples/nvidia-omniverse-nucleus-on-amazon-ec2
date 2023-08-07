# Copyright 2022 Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
# Licensed under the Amazon Software License  http://aws.amazon.com/asl/

import os
import logging
import json


from crhelper import CfnResource

import aws_utils.ssm as ssm
import aws_utils.sm as sm
import config.nucleus as config

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
logger = logging.getLogger()
logger.setLevel(LOG_LEVEL)

helper = CfnResource(json_logging=False, log_level="DEBUG",
                     boto_level="CRITICAL")


@helper.create
def create(event, context):
    logger.info("Create Event: %s", json.dumps(event, indent=2))

    instanceId = event["ResourceProperties"]["instanceId"]
    reverseProxyDomain = event["ResourceProperties"]["reverseProxyDomain"]
    artifactsBucket = event["ResourceProperties"]["artifactsBucket"]
    nucleusBuild = event["ResourceProperties"]["nucleusBuild"]
    ovMainLoginSecretArn = event["ResourceProperties"]["ovMainLoginSecretArn"]
    ovServiceLoginSecretArn = event["ResourceProperties"]["ovServiceLoginSecretArn"]

    response = update_nucleus_config(
        instanceId,
        artifactsBucket,
        reverseProxyDomain,
        nucleusBuild,
        ovMainLoginSecretArn,
        ovServiceLoginSecretArn,
    )
    logger.info("Run Command Results: %s", json.dumps(response, indent=2))


@helper.update
def update(event, context):
    logger.info("Update Event: %s", json.dumps(event, indent=2))

    instanceId = event["ResourceProperties"]["instanceId"]
    reverseProxyDomain = event["ResourceProperties"]["reverseProxyDomain"]
    artifactsBucket = event["ResourceProperties"]["artifactsBucket"]
    nucleusBuild = event["ResourceProperties"]["nucleusBuild"]
    ovMainLoginSecretArn = event["ResourceProperties"]["ovMainLoginSecretArn"]
    ovServiceLoginSecretArn = event["ResourceProperties"]["ovServiceLoginSecretArn"]

    response = update_nucleus_config(
        instanceId,
        artifactsBucket,
        reverseProxyDomain,
        nucleusBuild,
        ovMainLoginSecretArn,
        ovServiceLoginSecretArn,
    )
    logger.info("Run Command Results: %s", json.dumps(response, indent=2))


def update_nucleus_config(
    instanceId,
    artifactsBucket,
    reverseProxyDomain,
    nucleusBuild,
    ovMainLoginSecretArn,
    ovServiceLoginSecretArn,
):

    ovMainLoginSecret = sm.get_secret(ovMainLoginSecretArn)
    ovServiceLoginSecret = sm.get_secret(ovServiceLoginSecretArn)
    ovMainLoginPassword = ovMainLoginSecret["password"]
    ovServiceLoginPassword = ovServiceLoginSecret["password"]

    # generate config for reverse proxy servers
    commands = []
    try:
        commands = config.get_config(
            artifactsBucket, reverseProxyDomain, nucleusBuild, ovMainLoginPassword, ovServiceLoginPassword)
        logger.debug(commands)
    except Exception as e:
        raise Exception("Failed to get Reverse Proxy config. {}".format(e))

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
