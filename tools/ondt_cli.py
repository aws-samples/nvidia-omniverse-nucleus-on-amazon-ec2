"""
helper tools for stack manipulation
"""

# std lib modules
import os
import shutil
from pprint import pprint
from pathlib import Path

# 3rd party modules
import boto3
import click

# local modules
import ondt.ec2 as ec2
import ondt.s3 as s3

from dotenv import load_dotenv

load_dotenv()

OMNIVERSE_ARTIFACTS_BUCKETNAME = os.environ["OMNIVERSE_ARTIFACTS_BUCKETNAME"]


@click.group()
def main():
    pass


@main.command()
def package_tools_as_artifacts():
    bucket_name = OMNIVERSE_ARTIFACTS_BUCKETNAME

    p = Path(__file__)
    cur_dir_path = "/".join(list(p.parts[:-1]))

    source_tools_path = f"{cur_dir_path}/../src/tools"

    print(f"Archiving: {source_tools_path}")
    shutil.make_archive("tools", "zip", source_tools_path)

    s3.upload_file("tools.zip", bucket_name, "tools/tools.zip")

    os.remove("tools.zip")

    print(f"Done - {bucket_name}/tools/tools.zip")


@main.command()
@click.option("--instance_id")
@click.option("--ami_name")
def create_ami_from_instance(instance_id, ami_name):
    print("create_ami_from_instance", instance_id)
    resp = ec2.create_ami_from_instance(instance_id, ami_name)
    pprint(resp)
