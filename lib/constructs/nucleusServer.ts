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
	vpc: ec2.Vpc;
	artifactsBucket: s3.IBucket;
	nucleusServerSG: ec2.SecurityGroup;
	commonUtilsLambdaLayer: pyLambda.PythonLayerVersion;
};

export class NucluesServerResources extends Construct {
	public readonly nucleusServerInstance: ec2.Instance;

	constructor(scope: Construct, id: string, props: ConstructProps) {
		super(scope, id);

		const region: string = Stack.of(this).region;
		const account: string = Stack.of(this).account;
		const stackName: string = Stack.of(this).stackName;

		var removalPolicy = RemovalPolicy.DESTROY;

		const root_domain = `${env.ROOT_DOMAIN}`;
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

		const user_data = `#!/bin/bash
			echo ------------------------ NUCLEUS SERVER CONFIG ------------------------
			echo UPDATING AND INSTALLING DEPS ----------------------------------
			sudo apt-get update -y -q
			sudo apt-get install dialog apt-utils -y

			echo INSTALLING AWS CLI ----------------------------------
			sudo curl "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "awscliv2.zip"
			sudo apt-get install unzip
			sudo unzip awscliv2.zip
			sudo ./aws/install
			sudo rm awscliv2.zip
			sudo rm -fr ./aws/install

			echo INSTALLING PYTHON ----------------------------------
			sudo apt-get -y install python3.9
			sudo curl https://bootstrap.pypa.io/get-pip.py -o get-pip.py
			sudo python3.9 get-pip.py

			echo INSTALLING DOCKER ----------------------------------
			sudo apt-get remove docker docker-engine docker.io containerd runc
			sudo apt-get -y install apt-transport-https ca-certificates curl gnupg-agent software-properties-common
			curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo apt-key add -
			sudo add-apt-repository "deb [arch=amd64] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable"
			sudo apt-get -y update
			sudo apt-get -y install docker-ce docker-ce-cli containerd.io
			sudo systemctl enable --now docker

			echo INSTALLING DOCKER COMPOSE ----------------------------------
			sudo curl -L "https://github.com/docker/compose/releases/download/1.29.2/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
			sudo chmod +x /usr/local/bin/docker-compose
		`;

		this.nucleusServerInstance = new ec2.Instance(this, 'NucleusServer', {
			instanceType: new ec2.InstanceType('c5.4xlarge'),
			machineImage: nucleusServerAMI,
			blockDevices: [ebs_volume],
			vpc: props.vpc,
			role: instance_role,
			securityGroup: props.nucleusServerSG,
			userData: ec2.UserData.custom(user_data),
			vpcSubnets: props.vpc.selectSubnets({ subnetGroupName: 'public-subnet-nat-gateway' }),
			detailedMonitoring: true,
		});
		this.nucleusServerInstance.applyRemovalPolicy(removalPolicy);
		Tags.of(this.nucleusServerInstance).add('Name', `${stackName}/Omniverse-NucleusServer`);

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

		const nucleusServerConfig = new CustomResource(this, 'nucleusServerConfig', {
			lambdaCodePath: './src/lambda/customResources/nucleusServerConfig',
			lambdaPolicyDocument: nucleusConfigLambdaPolicy,
			resourceProps: {
				nounce: 2,
				instanceId: this.nucleusServerInstance.instanceId,
				reverseProxyDomain: fullDomainName,
				nucluesServerAddress: this.nucleusServerInstance.instancePrivateDnsName,
				nucleusBuild: env.NUCLEUS_BUILD,
				artifactsBucket: props.artifactsBucket.bucketName,
				ovMainLoginSecretArn: ovMainLogin.secretName,
				ovServiceLoginSecretArn: ovServiceLogin.secretArn,
			},
			commonLambdaLayer: props.commonUtilsLambdaLayer,
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
