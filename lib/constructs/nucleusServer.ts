import { Construct } from 'constructs';
import { Stack, Tags, RemovalPolicy } from 'aws-cdk-lib';
import { NagSuppressions } from 'cdk-nag';
import { CustomResource } from './common/customResource';
import { cleanEnv, bool, str } from 'envalid';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as pyLambda from '@aws-cdk/aws-lambda-python-alpha';
import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

dotenv.config();
const env = cleanEnv(process.env, {
	ALLOWED_CIDR_RANGE_01: str({ default: '' }),
	ALLOWED_CIDR_RANGE_02: str({ default: '' }),
	DEV_MODE: bool({ default: false }),
	ROOT_DOMAIN: str({ default: '' }),
	NUCLEUS_SERVER_PREFIX: str({ default: 'nucleus' }),
	NUCLEUS_BUILD: str({ default: '' }),
});

export type ConstructProps = {
	removalPolicy: RemovalPolicy;
	vpc: ec2.Vpc;
	subnets: ec2.ISubnet[];
	artifactsBucket: s3.IBucket;
	nucleusServerSG: ec2.SecurityGroup;
	lambdaLayers: pyLambda.PythonLayerVersion[];
};

export class NucleusServerResources extends Construct {
	public readonly nucleusServerInstance: ec2.Instance;

	constructor(scope: Construct, id: string, props: ConstructProps) {
		super(scope, id);

		const region: string = Stack.of(this).region;
		const account: string = Stack.of(this).account;
		const stackName: string = Stack.of(this).stackName;
		const fullDomainName = `${env.NUCLEUS_SERVER_PREFIX}.${env.ROOT_DOMAIN}`;

		// Templated secret
		const ovMainLogin = new secretsmanager.Secret(this, 'ovMainLogin', {
			generateSecretString: {
				secretStringTemplate: JSON.stringify({ username: 'omniverse' }),
				excludePunctuation: true,
				generateStringKey: 'password',
			},
		});
		// Templated secret
		const ovServiceLogin = new secretsmanager.Secret(this, 'ovServiceLogin', {
			generateSecretString: {
				secretStringTemplate: JSON.stringify({ username: 'omniverse' }),
				excludePunctuation: true,
				generateStringKey: 'password',
			},
		});

		const instance_role = new iam.Role(this, 'InstanceRole', {
			assumedBy: new iam.ServicePrincipal('ec2.amazonaws.com'),
			description: 'EC2 Instance Role',
			managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('AmazonSSMManagedInstanceCore')],
		});

		const ebs_volume: ec2.BlockDevice = {
			deviceName: '/dev/sda1',
			volume: ec2.BlockDeviceVolume.ebs(512, {
				encrypted: true,
			}),
		};

		// Canonical, Ubuntu, 20.04 LTS, amd64
		const nucleusServerAMI = ec2.MachineImage.fromSsmParameter(
			'/aws/service/canonical/ubuntu/server/focal/stable/current/amd64/hvm/ebs-gp2/ami-id',
			{
				os: ec2.OperatingSystemType.LINUX,
			}
		);

		this.nucleusServerInstance = new ec2.Instance(this, 'NucleusServer', {
			instanceType: new ec2.InstanceType('c5.4xlarge'),
			machineImage: nucleusServerAMI,
			blockDevices: [ebs_volume],
			vpc: props.vpc,
			role: instance_role,
			securityGroup: props.nucleusServerSG,
			vpcSubnets: { subnets: props.subnets },
			detailedMonitoring: true,
		});
		this.nucleusServerInstance.applyRemovalPolicy(props.removalPolicy);
		Tags.of(this.nucleusServerInstance).add('Name', `${stackName}/NucleusServer`);

		// artifacts bucket
		instance_role.addToPolicy(
			new iam.PolicyStatement({
				resources: [`${props.artifactsBucket.bucketArn}`, `${props.artifactsBucket.bucketArn}/*`],
				actions: ['s3:ListBucket', 's3:GetObject'],
			})
		);
		instance_role.addToPolicy(
			new iam.PolicyStatement({
				actions: [
					'logs:CreateLogGroup',
					'logs:CreateLogStream',
					'logs:DescribeLogStreams',
					'logs:PutLogEvents',
				],
				resources: ['arn:aws:logs:*:*:log-group:/aws/ssm/*'],
			})
		);

		// --------------------------------------------------------------------
		// CUSTOM RESOURCE - Nucleus Server Config
		// --------------------------------------------------------------------
		// Custom Resource to manage nucleus server configuration

		const nucleusConfigLambdaPolicy = new iam.PolicyDocument({
			statements: [
				new iam.PolicyStatement({
					actions: ['ssm:SendCommand'],
					resources: [
						`arn:aws:ec2:${region}:${account}:instance/${this.nucleusServerInstance.instanceId}`,
					],
				}),
				new iam.PolicyStatement({
					actions: ['ssm:SendCommand'],
					resources: ['arn:aws:ssm:*:*:document/*'],
				}),
				new iam.PolicyStatement({
					actions: ['ssm:GetCommandInvocation'],
					resources: [`arn:aws:ssm:${region}:${account}:*`],
				}),
				new iam.PolicyStatement({
					actions: ['secretsmanager:GetSecretValue', 'secretsmanager:DescribeSecret'],
					resources: [ovMainLogin.secretArn, ovServiceLogin.secretArn],
				}),
			],
		});

		const nucleusServerConfig = new CustomResource(this, 'NucleusServerConfig', {
			lambdaName: 'NucleusServerConfig',
			lambdaCodePath: './src/lambda/customResources/nucleusServerConfig',
			lambdaPolicyDocument: nucleusConfigLambdaPolicy,
			resourceProps: {
				nounce: 2,
				instanceId: this.nucleusServerInstance.instanceId,
				reverseProxyDomain: fullDomainName,
				nucleusBuild: env.NUCLEUS_BUILD,
				artifactsBucket: props.artifactsBucket.bucketName,
				ovMainLoginSecretArn: ovMainLogin.secretName,
				ovServiceLoginSecretArn: ovServiceLogin.secretArn,
			},
			lambdaLayers: props.lambdaLayers,
			removalPolicy: props.removalPolicy
		});
		nucleusServerConfig.resource.node.addDependency(this.nucleusServerInstance);

		// -------------------------------
		// CDK_NAG (security scan) suppressions
		// -------------------------------
		NagSuppressions.addResourceSuppressions(
			ovMainLogin,
			[
				{
					id: 'AwsSolutions-SMG4',
					reason:
						'Auto rotate secrets: Secrets Manager used to hold credentials required for deployment. Will be replaced by SSO strategy in production',
				},
			],
			true
		);
		NagSuppressions.addResourceSuppressions(
			ovServiceLogin,
			[
				{
					id: 'AwsSolutions-SMG4',
					reason:
						'Auto rotate secrets: Secrets Manager used to hold credentials required for deployment. Will be replaced by SSO strategy in production',
				},
			],
			true
		);
		NagSuppressions.addResourceSuppressions(
			instance_role,
			[
				{
					id: 'AwsSolutions-IAM5',
					reason:
						'Wildcard Permissions: Unable to know which objects exist ahead of time. Need to use wildcard',
				},
			],
			true
		);

		NagSuppressions.addResourceSuppressions(
			this.nucleusServerInstance,
			[
				{
					id: 'AwsSolutions-EC29',
					reason: 'CDK_NAG is not recognizing the applied removalPolicy',
				},
			],
			true
		);
	}
}
