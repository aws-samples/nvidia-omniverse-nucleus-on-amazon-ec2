import { Stack, StackProps } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { RevProxyResources } from './constructs/reverseProxy';
import { NucleusServerResources } from './constructs/nucleusServer';
import { VpcResources } from './constructs/vpc';
import { RemovalPolicy } from 'aws-cdk-lib';
import { NagSuppressions } from 'cdk-nag';
import { cleanEnv, str, bool } from 'envalid';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as pyLambda from '@aws-cdk/aws-lambda-python-alpha';
import * as dotenv from 'dotenv';
import { StorageResources } from './constructs/storageResources';
import { LoadBalancerConstruct } from './constructs/loadBalancer';
import { Route53Resources } from './constructs/route53';

dotenv.config();
const env = cleanEnv(process.env, {
	DEV_MODE: bool({ default: false }),
	OMNIVERSE_ARTIFACTS_BUCKETNAME: str({ default: '' }),
	ROOT_DOMAIN: str({ default: '' }),
	NUCLEUS_SERVER_PREFIX: str({ default: '' })
});

export class AppStack extends Stack {
	constructor(scope: Construct, id: string, props?: StackProps) {
		super(scope, id, props);

		const stackName: string = Stack.of(this).stackName;
		const region: string = Stack.of(this).region;

		var removalPolicy = RemovalPolicy.RETAIN;
		var autoDelete = false;
		if (env.DEV_MODE == true) {
			removalPolicy = RemovalPolicy.DESTROY;
			autoDelete = true;
		}

		const { artifactsBucket } = new StorageResources(this, "StorageResources", {
			bucketName: env.OMNIVERSE_ARTIFACTS_BUCKETNAME,
			autoDelete: autoDelete,
			removalPolicy: removalPolicy
		});

		const { certificate, hostedZone } = new Route53Resources(this, 'Route53Resources', {
			rootDomain: env.ROOT_DOMAIN,
		});

		const commonUtilsLambdaLayer = new pyLambda.PythonLayerVersion(this, 'CommonUtilsLayer', {
			entry: 'src/lambda/common',
			compatibleRuntimes: [lambda.Runtime.PYTHON_3_9],
			description: 'Data Model Schema Layer',
			layerVersionName: 'common_utils_layer',
		});

		const vpcResources = new VpcResources(this, 'VpcResources', {
			removalPolicy: removalPolicy,
		});

		const nucleusServerResources = new NucleusServerResources(this, 'NucleusServerResources', {
			removalPolicy: removalPolicy,
			vpc: vpcResources.vpc,
			subnets: vpcResources.subnets.nucleus,
			artifactsBucket: artifactsBucket,
			nucleusServerSG: vpcResources.securityGroups.nucleus,
			lambdaLayers: [commonUtilsLambdaLayer],
		});

		const reverseProxyResources = new RevProxyResources(this, 'RevProxyResources', {
			removalPolicy: removalPolicy,
			artifactsBucket: artifactsBucket,
			vpc: vpcResources.vpc,
			subnets: vpcResources.subnets.reverseProxy,
			securityGroup: vpcResources.securityGroups.reverseProxy,
			lambdaLayers: [commonUtilsLambdaLayer],
			nucleusServerInstance: nucleusServerResources.nucleusServerInstance,
		});

		reverseProxyResources.node.addDependency(nucleusServerResources);

		new LoadBalancerConstruct(this, 'LoadBalancerConstruct', {
			removalPolicy: removalPolicy,
			autoDelete: autoDelete,
			vpc: vpcResources.vpc,
			subnets: vpcResources.subnets.loadBalancer,
			securityGroup: vpcResources.securityGroups.loadBalancer,
			domainPrefix: env.NUCLEUS_SERVER_PREFIX,
			rootDomain: env.ROOT_DOMAIN,
			certificate: certificate,
			hostedZone: hostedZone,
			autoScalingGroup: reverseProxyResources.autoScalingGroup,
		});

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
