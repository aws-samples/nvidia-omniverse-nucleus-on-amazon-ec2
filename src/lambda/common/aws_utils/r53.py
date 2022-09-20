# Copyright 2022 Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
# Licensed under the Amazon Software License  http://aws.amazon.com/asl/


import boto3

client = boto3.client("route53")


def update_hosted_zone_cname_record(hostedZoneID, rootDomain, domainPrefix, serverAddress):

    fqdn = f"{domainPrefix}.{rootDomain}"

    response = client.change_resource_record_sets(
        HostedZoneId=hostedZoneID,
        ChangeBatch={
            "Comment": "Updating {fqdn}->{serverAddress} CNAME record",
            "Changes": [
                {
                    "Action": "UPSERT",
                    "ResourceRecordSet": {
                        "Name": fqdn,
                        "Type": "CNAME",
                        "TTL": 300,
                        "ResourceRecords": [{"Value": serverAddress}],
                    },
                }
            ],
        },
    )

    return response


def delete_hosted_zone_cname_record(hostedZoneID, rootDomain, domainPrefix, serverAddress):

    response = client.change_resource_record_sets(
        HostedZoneId=hostedZoneID,
        ChangeBatch={
            "Comment": "string",
            "Changes": [
                {
                    "Action": "DELETE",
                    "ResourceRecordSet": {
                        "Name": f"{domainPrefix}.{rootDomain}",
                        "Type": "CNAME",
                        "ResourceRecords": [{"Value": serverAddress}],
                    },
                }
            ],
        },
    )
    # botocore.errorfactory.InvalidInput: An error occurred (InvalidInput) when calling the ChangeResourceRecordSets operation: Invalid request:
    # Expected exactly one of [AliasTarget, all of [TTL, and ResourceRecords], or TrafficPolicyInstanceId], but found none in Change with
    # [Action=DELETE, Name=nucleus-dev.awsps.myinstance.com, Type=CNAME, SetIdentifier=null]
    return response
