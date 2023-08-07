# Copyright 2022 Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
# Licensed under the Amazon Software License  http://aws.amazon.com/asl/

from setuptools import setup

with open("README.md", "r") as fh:
    long_description = fh.read()

setup(
    name="Nucleus Server Tools",
    version="1.0",
    py_modules=[
        'nst'
    ],
    install_requires=[
        "boto3",
        "python-dotenv",
        "Click"
    ],
    entry_points='''
        [console_scripts]
        nst=nst_cli:main
    '''
)
