# Copyright 2022 Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
# Licensed under the Amazon Software License  http://aws.amazon.com/asl/

"""
helper tools for reverse proxy nginx configuration
"""

# std lib modules
import os
import logging
from pathlib import Path

# 3rd party modules
import click

import rpt.logger as logger

pass_config = click.make_pass_decorator(object, ensure=True)


@click.group()
@pass_config
def main(config):
    pass


@main.command()
@pass_config
def hello_world(config):
    logger.info(f'Hello World')


@main.command()
@pass_config
@click.option("--cert-arn", required=True)
def generate_acm_yaml(config, cert_arn):
    logger.info(f'generate_acm_yaml: {cert_arn=}')

    tools_path = '/'.join(list(Path(__file__).parts[:-1]))
    cur_dir_path = '.'

    template_path = f'{tools_path}/templates/acm.yaml'
    output_path = f'{cur_dir_path}/acm.yaml'

    logger.info(Path(template_path).is_file())

    data = ''
    with open(template_path, 'r') as file:
        data = file.read()

    data = data.format(cert_arn=cert_arn)

    with open(f'{output_path}', 'w') as file:
        file.write(data)

    logger.info(output_path)


@main.command()
@pass_config
@click.option("--domain", required=True)
@click.option("--server-address", required=True)
def generate_nginx_config(config, domain, server_address):
    logger.info(f'generate_nginx_config: {domain=}')

    nginx_template_path = os.path.join(
        os.getcwd(), 'templates', 'nginx.conf')
    if Path(nginx_template_path).is_file():
        logger.info(f"NGINX template found at: {nginx_template_path}")
    else:
        raise Exception(
            f"ERROR: No NGINX template found at: {nginx_template_path}")

    output_path = f'/etc/nginx/nginx.conf'
    if Path(output_path).is_file():
        logger.info(f"NGINX default configuration found at: {output_path}")
    else:
        raise Exception(
            f"ERROR: No NGINX default configuration found at: {output_path}. Verify NGINX installation.")

    data = ''
    with open(nginx_template_path, 'r') as file:
        data = file.read()

    data = data.format(PUBLIC_DOMAIN=domain,
                       NUCLEUS_SERVER_DOMAIN=server_address)

    with open(output_path, 'w') as file:
        file.write(data)

    logger.info(output_path)
