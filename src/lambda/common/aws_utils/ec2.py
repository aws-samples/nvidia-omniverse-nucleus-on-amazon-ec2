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
ec2_resource = boto3.resource("ec2")
autoscaling = boto3.client("autoscaling")


def get_instance_public_dns_name(instanceId):
    instance = get_instance_description(instanceId)

    if instance is None:
        return None

    return instance["PublicDnsName"]


def get_instance_private_dns_name(instanceId):
    instance = get_instance_description(instanceId)

    if instance is None:
        return None

    return instance["PrivateDnsName"]


def get_instance_description(instanceId):
    response = client.describe_instances(
        InstanceIds=[instanceId],
    )

    instances = response["Reservations"][0]["Instances"]
    if not instances:
        return None

    return instances[0]


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


def get_autoscaling_instance(groupName):
    response = autoscaling.describe_auto_scaling_groups(
        AutoScalingGroupNames=[groupName]
    )

    logger.debug(response)

    instances = response['AutoScalingGroups'][0]["Instances"]

    if not instances:
        return None

    instanceIds = []
    for i in instances:
        instanceIds.append(i["InstanceId"])

    return instanceIds


def update_tag_value(resourceIds: list, tagKey: str, tagValue: str):
    client.create_tags(
        Resources=resourceIds,
        Tags=[{
            'Key': tagKey,
            'Value': tagValue
        }],
    )


def delete_tag(resourceIds: list, tagKey: str, tagValue: str):
    response = client.delete_tags(
        Resources=resourceIds,
        Tags=[{
            'Key': tagKey,
            'Value': tagValue
        }],
    )
    return response


def get_instance_state(id):
    instance = ec2_resource.Instance(id)
    return instance.state['Name']


def get_instances_by_tag(tagKey, tagValue):
    instances = ec2_resource.instances.filter(
        Filters=[{'Name': 'tag:{}'.format(tagKey), 'Values': [tagValue]}])

    if not instances:
        return None

    instanceIds = []
    for i in instances:
        instanceIds.append(i.id)

    return instanceIds


def get_instances_by_name(name):
    instances = get_instances_by_tag("Name", name)

    if not instances:
        logger.error(f"ERROR: Failed to get instances by tag: Name, {name}")
        return None

    return instances


def get_active_instance(instances):
    for i in instances:
        instance_state = get_instance_state(i)
        logger.info(f"Instance: {i}. State: {instance_state}")

        if instance_state == "running" or instance_state == "pending":
            return i

    logger.warn(f"Instances are not active")
    return None


def get_volumes_by_instance_id(id):
    instance = ec2_resource.Instance(id)

    volumes = instance.volumes.all()

    volumeIds = []

    for i in volumes:
        volumeIds.append(i.id)

    return volumeIds


def terminate_instances(instance_ids):
    response = client.terminate_instances(InstanceIds=instance_ids)
    logger.info(response)
    return response
