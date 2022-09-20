# Copyright 2022 Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
# Licensed under the Amazon Software License  http://aws.amazon.com/asl/

import os
import logging

LOG_LEVEL = os.getenv('LOG_LEVEL', 'DEBUG')
logger = logging.getLogger()
logger.setLevel(LOG_LEVEL)

def info(*args):
    print(*args)

def debug(*args):
    print(*args)

def warning(*args):
    print(*args)

def error(*args):
    print(*args)