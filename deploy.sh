#!/bin/bash -e

# Copyright 2022 Amazon.com, Inc. or its affiliates. All Rights Reserved.
# SPDX-License-Identifier: LicenseRef-.amazon.com.-AmznSL-1.0
# Licensed under the Amazon Software License  http://aws.amazon.com/asl/

printf "BUILDING STACK...\n"

ACCOUNT_ID=$(aws sts get-caller-identity | grep -Eo '"Account"[^,]*' | grep -Eo '[^:]*$')
if [ -z "$ACCOUNT_ID" ]; then
    printf "\n[ERROR] Failed to get AWS Account ID. Verify your shell is configured with AWS and try again."
    exit 1
fi

printf "\nUsing AWS Account: %s\n" "$ACCOUNT_ID"

if test -f ".env"; then
    printf "\nSourcing environment from '.env'.\n"
    printf  "%s\n" "$(cat .env)"
else
    printf "\n[WARNING] No .env found. Creating default .env file.\n"
    DEFAULT_STACK_NAME="omni-app"
    DEFAULT_REGION="us-west-2"
    touch .env
    echo "export APP_STACK_NAME=${DEFAULT_STACK_NAME}" >> .env
    echo "export AWS_DEFAULT_REGION=${DEFAULT_REGION}" >> .env
fi
source .env

if [[ -z "${APP_STACK_NAME}" ]]; then
    printf "\n[ERROR] Missing Required ENV variable APP_STACK_NAME"
    exit 1
fi

printf "\nDEPLOYING STACK...\n"

cdk bootstrap && \
cdk synth && \
cdk deploy --require-approval never
