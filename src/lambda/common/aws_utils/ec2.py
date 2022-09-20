# Copyright 2022 Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
# Licensed under the Amazon Software License  http://aws.amazon.com/asl/


import os
import logging

import boto3
from botocore.exceptions import ClientError

LOG_LEVEL = os.getenv("LOG_LEVEL", "DEBUG")
logger = logging.getLogger()
logger.setLevel(LOG_LEVEL)

client = boto3.client("ec2")


def get_instance_public_dns_name(instanceId):
    response = client.describe_instances(InstanceIds=[instanceId])

    instances = response["Reservations"][0]["Instances"]
    if not instances:
        return None

    return instances[0]["PublicDnsName"]


def get_instance_status(instanceId):

    response = client.describe_instance_status(
        Filters=[
            {
                "Name": "string",
                "Values": [
                    "string",
                ],
            },
        ],
        InstanceIds=[
            "string",
        ],
        MaxResults=123,
        NextToken="string",
        DryRun=True | False,
        IncludeAllInstances=True | False,
    )

    statuses = response["InstanceStatuses"][0]
    status = {"instanceStatus": None, "systemStatus": None}

    if statuses:
        status = {
            "instanceStatus": statuses["InstanceStatus"]["Status"],
            "systemStatus": statuses["SystemStatus"]["Status"],
        }

    return status
