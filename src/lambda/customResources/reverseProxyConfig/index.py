import os
import logging
import json

from crhelper import CfnResource

import aws_utils.ssm as ssm
import aws_utils.ec2 as ec2
import config.reverseProxy as config

LOG_LEVEL = os.getenv("LOG_LEVEL", "DEBUG")
logger = logging.getLogger()
logger.setLevel(LOG_LEVEL)

helper = CfnResource(
    json_logging=False, log_level="DEBUG", boto_level="CRITICAL"
)


@helper.create
def create(event, context):
    logger.info("Create Event: %s", json.dumps(event, indent=2))

    response = update_config(
        event["ResourceProperties"]["STACK_NAME"],
        event["ResourceProperties"]["ARTIFACTS_BUCKET_NAME"],
        event["ResourceProperties"]["FULL_DOMAIN"],
        event["ResourceProperties"]["RP_AUTOSCALING_GROUP_NAME"],
    )
    logger.info("Run Command Results: %s", json.dumps(response, indent=2))


@helper.update
def update(event, context):
    logger.info("Update Event: %s", json.dumps(event, indent=2))

    response = update_config(
        event["ResourceProperties"]["STACK_NAME"],
        event["ResourceProperties"]["ARTIFACTS_BUCKET_NAME"],
        event["ResourceProperties"]["FULL_DOMAIN"],
        event["ResourceProperties"]["RP_AUTOSCALING_GROUP_NAME"],
    )
    logger.info("Run Command Results: %s", json.dumps(response, indent=2))


def update_config(
    stack_name,
    artifacts_bucket_name,
    full_domain,
    rp_autoscaling_group_name
):
    # get nucleus main instance id
    nucleus_instances = []
    try:
        nucleus_instances = ec2.get_instances_by_tag(
            "Name", f"{stack_name}/NucleusServer")
    except Exception as e:
        raise Exception(
            f"Failed to get nucleus instances by name. {e}")

    logger.info(f"Nucleus Instances: {nucleus_instances}")

    # get nucleus main hostname
    nucleus_hostname = ec2.get_instance_private_dns_name(nucleus_instances[0])
    logger.info(f"Nucleus Hostname: {nucleus_hostname}")

    # generate config for reverse proxy servers
    commands = []
    try:
        commands = config.get_config(
            artifacts_bucket_name, nucleus_hostname, full_domain)
        logger.debug(commands)
    except Exception as e:
        raise Exception(f"Failed to get Reverse Proxy config. {e}")

    # get reverse proxy instance ids
    rp_instances = ec2.get_autoscaling_instance(rp_autoscaling_group_name)
    if rp_instances is None:
        return None

    logger.info(rp_instances)

    # run config commands
    response = []
    for i in rp_instances:
        r = ssm.run_commands(
            i, commands, document="AWS-RunShellScript"
        )
        response.append(r)

    return response


@helper.delete
def delete(event, context):
    logger.info("Delete Event: %s", json.dumps(event, indent=2))


def handler(event, context):
    helper(event, context)
