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

logger = logging.getLogger()
logger.setLevel(logging.INFO)

autoscaling = boto3.client("autoscaling")

R53_HOSTED_ZONE_ID = os.environ["R53_HOSTED_ZONE_ID"]
ARTIFACTS_BUCKET = os.environ["ARTIFACTS_BUCKET"]
NUCLEUS_ROOT_DOMAIN = os.environ["NUCLEUS_ROOT_DOMAIN"]
NUCLEUS_DOMAIN_PREFIX = os.environ["NUCLEUS_DOMAIN_PREFIX"]
NUCLEUS_SERVER_ADDRESS = os.environ["NUCLEUS_SERVER_ADDRESS"]
REVERSE_PROXY_SSL_CERT_ARN = os.environ["REVERSE_PROXY_SSL_CERT_ARN"]


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
    instanceId, artifactsBucket, nucleusServerAddress, certArn, domain
):

    commands = [
        # install python3.9
        # this should be baked into the AMI to avoid installing every time
        # set here to avoid managing additional AMI artifact during prototype engagement
        "yum -y update",
        "yum install gcc openssl-devel bzip2-devel libffi-devel zlib-devel -y",
        "wget https://www.python.org/ftp/python/3.9.6/Python-3.9.6.tgz",
        "tar xzf Python-3.9.6.tgz",
        "cd Python-3.9.6",
        "./configure --prefix=/usr  --enable-optimizations",
        "make install",
        # install custom reverse proxy tools - see ./src/tools/reverseProxy
        f"aws s3 cp s3://{artifactsBucket}/tools/tools.zip ./tools.zip",
        "unzip -o tools.zip",
        "cd reverseProxy",
        "pip3 --version",
        "pip3 install -r requirements.txt",
        # configure server
        f"rpt generate-acm-yaml --cert-arn {certArn}",
        f"rpt generate-nginx-config --domain {domain} --server-address {nucleusServerAddress}",
        "mv acm.yaml /etc/nitro_enclaves/acm.yaml",
        "mv nginx.conf /etc/nginx/nginx.conf",
        # start server
        "systemctl start nitro-enclaves-acm.service",
        "systemctl enable nitro-enclaves-acm",
    ]

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

            revProxyServerAddress = ec2.get_instance_public_dns_name(instanceId)

            # TODO: get instance status via ec2 describe-instance-status,
            # loop with falloff until InstanceStatus['Status'] == 'ok' and SystemStatus['Status'] == 'ok'

            r53.update_hosted_zone_cname_record(
                R53_HOSTED_ZONE_ID,
                NUCLEUS_ROOT_DOMAIN,
                NUCLEUS_DOMAIN_PREFIX,
                revProxyServerAddress,
            )

            update_nginix_config(
                instanceId,
                ARTIFACTS_BUCKET,
                NUCLEUS_SERVER_ADDRESS,
                REVERSE_PROXY_SSL_CERT_ARN,
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

            serverAddress = ec2.get_instance_public_dns_name(instanceId)

            r53.delete_hosted_zone_cname_record(
                R53_HOSTED_ZONE_ID,
                NUCLEUS_ROOT_DOMAIN,
                NUCLEUS_DOMAIN_PREFIX,
                serverAddress,
            )

            send_lifecycle_action(event, "CONTINUE")

        except Exception as e:

            message = "Error running command: {}".format(e)
            logger.warning(traceback.format_exc())
            logger.error(message)
            send_lifecycle_action(event, "ABANDON")

    logger.info("Execution Complete")

    return
