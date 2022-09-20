#!/bin/bash -e

# Copyright 2022 Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
# Licensed under the Amazon Software License  http://aws.amazon.com/asl/

echo '
###############################
# Building and deploying Stack
###############################
'

default_stack_name="omni-app"
default_region="us-west-2"

aws sts get-caller-identity
if [[ $? -ne 0 ]]; then
    exit 1
fi

if test -f ".env"; then
    echo ".env found, sourcing environment"
    source .env
else
    echo "Creating default .env file"
    touch .env
    echo "export APP_STACK_NAME=${default_stack_name}" >> .env
    echo "export AWS_DEFAULT_REGION=${default_region}" >> .env

    source .env
fi

missing_vars=0

if [[ -z "${APP_STACK_NAME}" ]]; then
  echo "Missing Required ENV variable APP_STACK_NAME"
  let missing_vars=1
fi

if [ $missing_vars -eq 1 ]; then
	exit 1
fi

cdk bootstrap && \
cdk synth && \
cdk deploy --require-approval never
