# Copyright 2022 Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
# Licensed under the Amazon Software License  http://aws.amazon.com/asl/

import os
import logging
import json


import boto3
from crhelper import CfnResource

LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
logger = logging.getLogger()
logger.setLevel(LOG_LEVEL)

helper = CfnResource(
    json_logging=False, log_level="DEBUG", boto_level="CRITICAL"
)


@helper.create
def create(event, context):
    logger.info("Create Event: %s", json.dumps(event, indent=2))

    certArn = event["ResourceProperties"]["certArn"]
    roleArn = event["ResourceProperties"]["roleArn"]
    rolePolicy = event["ResourceProperties"]["rolePolicy"]
    region = event["ResourceProperties"]["region"]

    remove_enclave_certification_associations(certArn)
    associate_enclave_certificate_iam_role(certArn, roleArn, rolePolicy, region)

    # update instance nginx config

    # Items stored in helper.Data will be saved
    # as outputs in your resource in CloudFormation
    # helper.Data.update({"test": "testdata"})
    return "Success"


@helper.update
def update(event, context):
    logger.info("Update Event: %s", json.dumps(event, indent=2))

    certArn = event["ResourceProperties"]["certArn"]
    roleArn = event["ResourceProperties"]["roleArn"]
    rolePolicy = event["ResourceProperties"]["rolePolicy"]
    region = event["ResourceProperties"]["region"]

    remove_enclave_certification_associations(certArn)
    associate_enclave_certificate_iam_role(certArn, roleArn, rolePolicy, region)

    # helper.Data.update({"test": "testdata"})
    return "Success"


@helper.delete
def delete(event, context):

    certArn = event["ResourceProperties"]["certArn"]
    remove_enclave_certification_associations(certArn)

    logger.info("Delete Event: %s", json.dumps(event, indent=2))


# Util Functions


def remove_enclave_certification_associations(certArn):
    logger.info("remove_enclave_certification_associations")

    ec2_client = boto3.client("ec2")

    response = ec2_client.get_associated_enclave_certificate_iam_roles(
        CertificateArn=certArn
    )

    logger.info("Current Associated Roles: %s", json.dumps(response, indent=2))

    for role in response["AssociatedRoles"]:
        oldRoleArn = role["AssociatedRoleArn"]
        response = ec2_client.disassociate_enclave_certificate_iam_role(
            CertificateArn=certArn, RoleArn=oldRoleArn
        )

    return True


def associate_enclave_certificate_iam_role(
    certArn, roleArn, rolePolicyArn, region
):

    logger.info("associate_enclave_certificate_iam_role")

    ec2_client = boto3.client("ec2")
    iam_client = boto3.client("iam")
    iam_rsrc = boto3.resource("iam")

    response = ec2_client.associate_enclave_certificate_iam_role(
        CertificateArn=certArn, RoleArn=roleArn
    )

    bucket = response["CertificateS3BucketName"]
    s3object = response["CertificateS3ObjectKey"]
    kmskeyid = response["EncryptionKmsKeyId"]

    # update policy with association resources
    policy = iam_rsrc.Policy(rolePolicyArn)
    policyJson = policy.default_version.document
    cur_version = policy.default_version_id

    logger.info("Current Role Policy: %s", json.dumps(policyJson, indent=2))

    policyJson["Statement"] = [
        {
            "Effect": "Allow",
            "Action": ["s3:GetObject"],
            "Resource": [f"arn:aws:s3:::{bucket}/*"],
        },
        {
            "Sid": "VisualEditor0",
            "Effect": "Allow",
            "Action": ["kms:Decrypt"],
            "Resource": f"arn:aws:kms:{region}:*:key/{kmskeyid}",
        },
        {"Effect": "Allow", "Action": "iam:GetRole", "Resource": roleArn},
    ]

    response = iam_client.create_policy_version(
        PolicyArn=rolePolicyArn,
        PolicyDocument=json.dumps(policyJson),
        SetAsDefault=True,
    )

    response = iam_client.delete_policy_version(
        PolicyArn=rolePolicyArn, VersionId=cur_version
    )

    return True


def handler(event, context):
    helper(event, context)
