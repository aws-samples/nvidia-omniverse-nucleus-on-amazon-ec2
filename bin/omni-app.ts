#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { AppStack } from '../lib/omni-app-stack';
import { AwsSolutionsChecks, NagSuppressions } from 'cdk-nag';

import { cleanEnv, makeValidator, str, bool, host } from 'envalid';

const stackname = makeValidator((x) => {
	if (/^[A-Za-z][A-Za-z-0-9]{0,126}[A-Za-z0-9]$/.test(x)) return x;
	else
		throw new Error(
			`Invalid Stack name: ${x}. Can contain only alphanumeric characters (case-sensitive) and hyphens. It must start with an alphabetic character and can't be longer than 128 characters.`
		);
});

const bucketname = makeValidator((x) => {
	if (/(?!(^xn--|-s3alias$))^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(x)) return x;
	else
		throw new Error(
			`Invalid Bucket name: ${x}. Can contain only lowercase alphanumeric characters and hyphens. It must start with an alphabetic character and must be between 3 and 63 characters characters.`
		);
});

const domainprefix = makeValidator((x) => {
	if (/^[A-Za-z][A-Za-z-0-9]{0,126}[A-Za-z0-9]$/.test(x)) return x;
	else
		throw new Error(
			`Invalid Domain Prefix: ${x}. Can contain only alphanumeric characters (case-sensitive) and hyphens. It must start with an alphabetic character and can't be longer than 128 characters.`
		);
});

const cidrrange = makeValidator((x) => {
	if (/^([0-9]{1,3}\.){3}[0-9]{1,3}(\/([0-9]|[1-2][0-9]|3[0-2]))?$/.test(x)) return x;
	else throw new Error(`Invalid CIDR Range: ${x}`);
});

const env = cleanEnv(process.env, {
	APP_STACK_NAME: stackname({ default: 'omni-app' }),
	DEV_MODE: bool({ default: false }),
	AWS_DEFAULT_REGION: str({ choices: ['us-east-1', 'us-east-2', 'us-west-1', 'us-west-2', 'eu-west-1', 'eu-west-2', 'eu-west-3', 'eu-south-1'] }),
	OMNIVERSE_ARTIFACTS_BUCKETNAME: bucketname(),
	ROOT_DOMAIN: host(),
	NUCLUES_SERVER_PREFIX: domainprefix(),
	NUCLEUS_BUILD: str({ choices: ['nucleus-stack-2022.1.0+tag-2022.1.0.gitlab.3983146.613004ac'] }),
	ALLOWED_CIDR_RANGE_01: cidrrange(),
	ALLOWED_CIDR_RANGE_02: cidrrange({ default: '' }),
	ALLOWED_CIDR_RANGE_03: cidrrange({ default: '' })
});

var app_stack_name = env.APP_STACK_NAME;
if (env.DEV_MODE) {
	app_stack_name = `${app_stack_name}-dev`;
}

const app = new cdk.App();
const stack = new AppStack(app, app_stack_name, {
	/* If you don't specify 'env', this stack will be environment-agnostic.
	 * Account/Region-dependent features and context lookups will not work,
	 * but a single synthesized template can be deployed anywhere. */

	/* Uncomment the next line to specialize this stack for the AWS Account
	 * and Region that are implied by the current CLI configuration. */
	env: { account: process.env.CDK_DEFAULT_ACCOUNT, region: process.env.CDK_DEFAULT_REGION }

	/* Uncomment the next line if you know exactly what Account and Region you
	 * want to deploy the stack to. */
	// env: { account: '123456789012', region: 'us-east-1' },

	/* For more information, see https://docs.aws.amazon.com/cdk/latest/guide/environments.html */
});

// Uncomment for security review
// cdk.Aspects.of(app).add(new AwsSolutionsChecks({ verbose: true }));
NagSuppressions.addStackSuppressions(stack, [
	{
		id: 'AwsSolutions-IAM4',
		reason: 'Auto-generated resource with managed policy',
		appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/service-role/AWSLambdaBasicExecutionRole']
	},
	{
		id: 'AwsSolutions-IAM4',
		reason: 'Internal Config rule requires AmazonSSMManagedInstanceCore be added to instances',
		appliesTo: ['Policy::arn:<AWS::Partition>:iam::aws:policy/AmazonSSMManagedInstanceCore']
	}
]);
