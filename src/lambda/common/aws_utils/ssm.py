# Copyright 2022 Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
# Licensed under the Amazon Software License  http://aws.amazon.com/asl/

import os
import time
import logging

import boto3
from botocore.exceptions import ClientError

LOG_LEVEL = os.getenv("LOG_LEVEL", "DEBUG")
logger = logging.getLogger()
logger.setLevel(LOG_LEVEL)

client = boto3.client("ssm")


def get_param_value(name) -> str:
    response = client.get_parameter(Name=name)
    logger.info(response)
    return response['Parameter']['Value']


def update_param_value(name, value) -> bool:
    response = client.put_parameter(Name=name, Value=value, Overwrite=True)
    logger.info(response)

    try:
        return (response['Version'] > 0)
    except ClientError as e:
        message = "Error calling SendCommand: {}".format(e)
        logger.error(message)
        return False


def run_commands(
    instance_id, commands, document="AWS-RunPowerShellScript", comment="aws_utils.ssm.run_commands"
):
    """alt document options:
    AWS-RunShellScript
    """

    # Run Commands
    logger.info("Calling SendCommand: {} for instance: {}".format(
        commands, instance_id))
    attempt = 0
    response = None
    while attempt < 20:
        attempt = attempt + 1
        try:
            time.sleep(10 * attempt)
            logger.info("SendCommand, attempt #: {}".format(attempt))
            response = client.send_command(
                InstanceIds=[instance_id],
                DocumentName=document,
                Parameters={"commands": commands},
                Comment=comment,
                CloudWatchOutputConfig={
                    "CloudWatchLogGroupName": instance_id,
                    "CloudWatchOutputEnabled": True,
                },
            )

            logger.info(response)
            if "Command" in response:
                break

            if attempt == 10:
                message = "Command did not execute successfully in time allowed."
                raise Exception(message)

        except ClientError as e:
            message = "Error calling SendCommand: {}".format(e)
            logger.error(message)
            continue

    if not response:
        message = "Command did not execute successfully in time allowed."
        raise Exception(message)

    # Check Command Status
    command_id = response["Command"]["CommandId"]
    logger.info(
        "Calling GetCommandInvocation for command: {} for instance: {}".format(
            command_id, instance_id
        )
    )
    attempt = 0
    result = None
    while attempt < 10:
        attempt = attempt + 1
        try:
            time.sleep(10 * attempt)
            logger.info("GetCommandInvocation, attempt #: {}".format(attempt))
            result = client.get_command_invocation(
                CommandId=command_id,
                InstanceId=instance_id,
            )

            if result["Status"] == "InProgress":
                logger.info("Command is running.")
                continue

            elif result["Status"] == "Success":
                logger.info("Command Output: {}".format(
                    result["StandardOutputContent"]))

                if result["StandardErrorContent"]:
                    message = "Command returned STDERR: {}".format(
                        result["StandardErrorContent"])
                    logger.warning(message)

                break

            elif result["Status"] == "Failed":
                message = "Error Running Command: {}".format(
                    result["StandardErrorContent"])
                logger.error(message)
                raise Exception(message)

            else:
                message = "Command has an unhandled status, will continue: {}".format(
                    e)
                logger.warning(message)
                continue

        except client.exceptions.InvocationDoesNotExist as e:
            message = "Error calling GetCommandInvocation: {}".format(e)
            logger.error(message)
            raise Exception(message)

    if not result or result["Status"] != "Success":
        message = "Command did not execute successfully in time allowed."
        raise Exception(message)

    return result
