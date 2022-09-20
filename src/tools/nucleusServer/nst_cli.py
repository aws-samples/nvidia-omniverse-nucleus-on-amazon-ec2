# Copyright 2022 Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
# Licensed under the Amazon Software License  http://aws.amazon.com/asl/

# Copyright 2022 Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
# Licensed under the Amazon Software License  http://aws.amazon.com/asl/

"""
helper tools for omniverse nucleus deployment configuration
"""

# std lib modules
import os
import logging
from pathlib import Path

# 3rd party modules
import click

import nst.logger as logger

pass_config = click.make_pass_decorator(object, ensure=True)


@click.group()
@pass_config
def main(config):
    pass


@main.command()
@pass_config
@click.option("--my_opt_arg")
def hello_world(config, my_opt_arg):
    logger.info(f"Hello World: {my_opt_arg=}")


@main.command()
@pass_config
@click.option("--server-ip", required=True)
@click.option("--reverse-proxy-domain", required=True)
@click.option("--instance-name", required=True)
@click.option("--master-password", required=True)
@click.option("--service-password", required=True)
@click.option("--data-root", required=True)
def generate_nucleus_stack_env(
    config,
    server_ip,
    reverse_proxy_domain,
    instance_name,
    master_password,
    service_password,
    data_root,
):
    logger.info(
        f"generate_nucleus_stack_env:{server_ip=},{reverse_proxy_domain=},{instance_name=},{master_password=},{service_password=},{data_root=}"
    )

    tools_path = "/".join(list(Path(__file__).parts[:-1]))
    cur_dir_path = "."

    template_name = "nucleus-stack.env"
    template_path = f"{tools_path}/templates/{template_name}"
    output_path = f"{cur_dir_path}/{template_name}"

    if not Path(template_path).is_file():
        raise Exception("File not found: {template_path}")

    data = ""
    with open(template_path, "r") as file:
        data = file.read()

    data = data.format(
        SERVER_IP_OR_HOST=server_ip,
        REVERSE_PROXY_DOMAIN=reverse_proxy_domain,
        INSTANCE_NAME=instance_name,
        MASTER_PASSWORD=master_password,
        SERVICE_PASSWORD=service_password,
        DATA_ROOT=data_root,
        ACCEPT_EULA="1",
        SECURITY_REVIEWED="1",
    )

    with open(f"{output_path}", "w") as file:
        file.write(data)

    logger.info(output_path)
