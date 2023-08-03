

import { Fn, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { RemovalPolicy, CfnOutput } from 'aws-cdk-lib';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as deployment from 'aws-cdk-lib/aws-s3-deployment';
import * as path from 'path';


export interface StorageResourcesProps {
    removalPolicy: RemovalPolicy,
    autoDelete: boolean;
    bucketName?: string;
};

export class StorageResources extends Construct {
    public readonly artifactsBucket: s3.Bucket;

    constructor(scope: Construct, id: string, props: StorageResourcesProps) {
        super(scope, id);

        const bucketName = props.bucketName ?? `${Stack.of(this).stackName}-omniverse-nucleus-artifacts-bucket`;
        const sourceBucket = new s3.Bucket(this, 'ArtifactsBucket', {
            bucketName: bucketName,
            autoDeleteObjects: props.autoDelete,
            removalPolicy: props.removalPolicy,
        });

        const artifactsDeployment = new deployment.BucketDeployment(this, "ArtifactsDeployment", {
            sources: [deployment.Source.asset(path.join(__dirname, "..", "..", "src", "tools"))],
            destinationBucket: sourceBucket,
            destinationKeyPrefix: "tools",
            extract: true,
            exclude: ["*.DS_Store"]
        });

        this.artifactsBucket = artifactsDeployment.deployedBucket as s3.Bucket;

        /**
         * CFN Outputs
         */
        new CfnOutput(this, "ArtifactsBucketName", {
            value: this.artifactsBucket.bucketName,
        }).overrideLogicalId("ArtifactsBucketName");

        new CfnOutput(this, "DeployedObjectKeys", {
            value: Fn.select(0, artifactsDeployment.objectKeys)
        });
    }
}