import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { RevProxyResources } from './constructs/reverseProxy';
import { NucleusServerResources } from './constructs/nucleusServer';
import { VpcResources } from './constructs/vpc';
import { RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import { NagSuppressions } from 'cdk-nag';
import { cleanEnv, str, bool } from 'envalid';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as deployment from 'aws-cdk-lib/aws-s3-deployment';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as pyLambda from '@aws-cdk/aws-lambda-python-alpha';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config();
const env = cleanEnv(process.env, {
	DEV_MODE: bool({ default: false }),
	OMNIVERSE_ARTIFACTS_BUCKETNAME: str({ default: '' }),
});

export class AppStack extends Stack {
	constructor(scope: Construct, id: string, props?: StackProps) {
		super(scope, id, props);

		const stackName: string = Stack.of(this).stackName;

		var removalPolicy = RemovalPolicy.RETAIN;
		var autoDeleteObjects = false;
		if (env.DEV_MODE == true) {
			removalPolicy = RemovalPolicy.DESTROY;
			autoDeleteObjects = true;
		}

		const artifactsBucket = new s3.Bucket(this, 'ArtifactsBucket', {
			bucketName: env.OMNIVERSE_ARTIFACTS_BUCKETNAME ?? `${Stack.of(this).stackName}-omniverse-nucleus-artifacts-bucket`,
			autoDeleteObjects: autoDeleteObjects,
			removalPolicy: removalPolicy,
		});

		const artifactsDeployment = new deployment.BucketDeployment(this, "ArtifactsDeployment", {
			sources: [deployment.Source.asset(path.join(__dirname, "..", "src", "tools"))],
			destinationBucket: artifactsBucket,
			destinationKeyPrefix: "tools",
			extract: true,
			exclude: ["*.DS_Store"]
		});

		const commonUtilsLambdaLayer = new pyLambda.PythonLayerVersion(this, 'CommonUtilsLayer', {
			entry: 'src/lambda/common',
			compatibleRuntimes: [lambda.Runtime.PYTHON_3_9],
			description: 'Data Model Schema Layer',
			layerVersionName: 'common_utils_layer',
		});

		const vpcResources = new VpcResources(this, 'VpcResources', {});

		const nucleusServerResources = new NucleusServerResources(this, 'NucleusServerResources', {
			vpc: vpcResources.vpc,
			artifactsBucket: artifactsBucket,
			nucleusServerSG: vpcResources.nucleusSG,
			commonUtilsLambdaLayer: commonUtilsLambdaLayer,
		});

		const reverseProxyResources = new RevProxyResources(this, 'RevProxyResources', {
			vpc: vpcResources.vpc,
			artifactsBucket: artifactsBucket,
			reverseProxySG: vpcResources.reverseProxySG,
			hostedZone: vpcResources.hostedZone,
			certificate: vpcResources.certificate,
			commonUtilsLambdaLayer: commonUtilsLambdaLayer,
			nucleusServerInstance: nucleusServerResources.nucleusServerInstance,
		});

		new CfnOutput(this, 'artifactsBucket', {
			value: artifactsBucket.bucketName,
		}).overrideLogicalId('artifactsBucket');

		// -------------------------------
		// NagSuppressions
		// -------------------------------
		for (let i = 0; i < this.node.children.length; i++) {
			const child = this.node.children[i];
			if (child.constructor.name === 'LogRetentionFunction') {
				NagSuppressions.addResourceSuppressionsByPath(
					this,
					`/${stackName}/${child.node.id}/ServiceRole/DefaultPolicy/Resource`,
					[{ id: 'AwsSolutions-IAM5', reason: 'Auto-generated resource with wildcard policy' }]
				);
			}
		}
	}
}
