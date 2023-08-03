import { Construct } from 'constructs';
import { Stack, Duration, RemovalPolicy } from 'aws-cdk-lib';
import * as autoscaling from 'aws-cdk-lib/aws-autoscaling';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as pyLambda from '@aws-cdk/aws-lambda-python-alpha';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as events from 'aws-cdk-lib/aws-events';
import * as targets from 'aws-cdk-lib/aws-events-targets';
import { NagSuppressions } from 'cdk-nag';

export interface AutoScalingResourceProps {
    name: string;
    removalPolicy: RemovalPolicy;
    artifactsBucket: s3.IBucket;
    vpcResources: {
        vpc: ec2.Vpc;
        subnets: ec2.ISubnet[];
    };
    launchTemplate: ec2.LaunchTemplate;
    capacity: {
        min: number;
        max: number;
    };
    lambdaResources?: {
        entry: string;
        layers: pyLambda.PythonLayerVersion[];
        environment: { [key: string]: string; };
        policies?: { [key: string]: iam.PolicyDocument; };
    };
}

export class AutoScalingResources extends Construct {
    public readonly autoScalingGroup: autoscaling.AutoScalingGroup;

    constructor(scope: Construct, id: string, props: AutoScalingResourceProps) {
        super(scope, id);

        const region: string = Stack.of(this).region;
        const account: string = Stack.of(this).account;

        this.autoScalingGroup = new autoscaling.AutoScalingGroup(
            this,
            `${props.name}AutoScalingGroup`,
            {
                vpc: props.vpcResources.vpc,
                vpcSubnets: { subnets: props.vpcResources.subnets },
                minCapacity: props.capacity.min,
                maxCapacity: props.capacity.max,
                launchTemplate: props.launchTemplate,
                updatePolicy: autoscaling.UpdatePolicy.replacingUpdate(),
                healthCheck: autoscaling.HealthCheck.ec2({ grace: Duration.minutes(1) }),
            }
        );

        if (props.lambdaResources != undefined) {
            // Scale Up Lifecycle Hook
            this.autoScalingGroup.addLifecycleHook(`${props.name}ScaleUpLifecycleHook`, {
                heartbeatTimeout: Duration.seconds(300),
                defaultResult: autoscaling.DefaultResult.ABANDON,
                lifecycleTransition: autoscaling.LifecycleTransition.INSTANCE_LAUNCHING,
            });

            // Scale Down Lifecycle Hook
            this.autoScalingGroup.addLifecycleHook(`${props.name}ScaleDownLifecycleHook`, {
                heartbeatTimeout: Duration.seconds(300),
                defaultResult: autoscaling.DefaultResult.ABANDON,
                lifecycleTransition: autoscaling.LifecycleTransition.INSTANCE_TERMINATING,
            });

            const lifecycleLambdaPolicy = new iam.PolicyDocument({
                statements: [
                    new iam.PolicyStatement({
                        resources: [`${this.autoScalingGroup.autoScalingGroupArn}`],
                        actions: ['autoscaling:CompleteLifecycleAction'],
                    }),
                    new iam.PolicyStatement({
                        actions: ['autoscaling:DescribeAutoScalingGroups'],
                        resources: ['*'],
                    }),
                    new iam.PolicyStatement({
                        resources: [
                            `arn:aws:ssm:${region}::document/AWS-RunPowerShellScript`,
                            `arn:aws:ssm:${region}::document/AWS-RunShellScript`,
                        ],
                        actions: ['ssm:SendCommand'],
                    }),
                    new iam.PolicyStatement({
                        resources: ['arn:aws:ec2:*:*:instance/*'],
                        actions: ['ssm:SendCommand'],
                        conditions: {
                            StringEquals: {
                                'iam:ssm:ResourceTag/aws:autoscaling:groupName':
                                    this.autoScalingGroup.autoScalingGroupName,
                            },
                        },
                    }),
                    new iam.PolicyStatement({
                        resources: ['*'],
                        actions: ['ssm:GetCommandInvocation'],
                    }),
                ],
            });

            const configLambdaPolicy = new iam.PolicyDocument({
                statements: [
                    new iam.PolicyStatement({
                        actions: ['ssm:SendCommand'],
                        resources: [`arn:aws:ec2:${region}:${account}:instance/*`],
                    }),
                    new iam.PolicyStatement({
                        actions: ['ec2:DescribeInstances', 'ec2:DescribeInstanceStatus'],
                        resources: [`*`],
                    }),
                    new iam.PolicyStatement({
                        actions: ['ssm:SendCommand'],
                        resources: ['arn:aws:ssm:*:*:document/*'],
                    }),
                    new iam.PolicyStatement({
                        actions: ['ssm:GetCommandInvocation'],
                        resources: [`arn:aws:ssm:${region}:${account}:*`],
                    }),
                ],
            });

            const lifecycleLambdaRole = new iam.Role(this, `${props.name}LifecycleLambdaRole`, {
                assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
                managedPolicies: [iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaVPCAccessExecutionRole')],
                inlinePolicies: {
                    lifecycleLambdaPolicy: lifecycleLambdaPolicy,
                    configLambdaPolicy: configLambdaPolicy,
                    ...props.lambdaResources.policies,
                },
            });

            const lambdaName = `${props.name}AutoScalingLifecycleLambdaFunction`.slice(0, 64);

            const logGroup = new logs.LogGroup(this, 'LifecycleLambdaFnLogGroup', {
                retention: logs.RetentionDays.ONE_WEEK,
                removalPolicy: props.removalPolicy,
            });

            const lifecycleLambdaFn = new pyLambda.PythonFunction(
                this,
                `${props.name}LifecycleLambdaFn`,
                {
                    functionName: lambdaName,
                    runtime: lambda.Runtime.PYTHON_3_9,
                    handler: 'handler',
                    entry: props.lambdaResources.entry,
                    role: lifecycleLambdaRole,
                    timeout: Duration.minutes(5),
                    layers: props.lambdaResources.layers,
                    environment: props.lambdaResources.environment,
                    vpc: props.vpcResources.vpc,
                    vpcSubnets: {
                        subnets: props.vpcResources.subnets
                    },
                }
            );

            lifecycleLambdaFn.node.addDependency(logGroup);

            lifecycleLambdaFn.addToRolePolicy(
                new iam.PolicyStatement({
                    actions: ['logs:CreateLogStream', 'logs:PutLogEvents'],
                    resources: [logGroup.logGroupArn],
                })
            );

            const rule = new events.Rule(this, `${props.name}EventRule`, {
                eventPattern: {
                    source: ['aws.autoscaling'],
                    detailType: [
                        'EC2 Instance-launch Lifecycle Action',
                        'EC2 Instance-terminate Lifecycle Action',
                    ],
                    detail: {
                        AutoScalingGroupName: [this.autoScalingGroup.autoScalingGroupName],
                    },
                },
            });
            rule.node.addDependency(lifecycleLambdaFn);
            rule.addTarget(new targets.LambdaFunction(lifecycleLambdaFn));

            NagSuppressions.addResourceSuppressions(
                lifecycleLambdaRole,
                [
                    {
                        id: 'AwsSolutions-IAM5',
                        reason:
                            'Wildcard Permissions: This is a Dummy Policy with minimal actions. This policy is updated on the fly by the revProxyCertAssociation custom resource',
                    },
                ],
                true
            );
        }

        NagSuppressions.addResourceSuppressions(
            this.autoScalingGroup,
            [
                {
                    id: 'AwsSolutions-AS3',
                    reason:
                        'Autoscaling Event notifications: Backlogged, will provide guidance in production document',
                },
            ],
            true
        );
    }
}
