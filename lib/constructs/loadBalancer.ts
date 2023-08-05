import { Construct } from 'constructs';
import { Duration, RemovalPolicy } from 'aws-cdk-lib';
import { ISubnet, SecurityGroup, Vpc } from 'aws-cdk-lib/aws-ec2';
import { Certificate } from 'aws-cdk-lib/aws-certificatemanager';
import { ARecord, IHostedZone, RecordTarget } from 'aws-cdk-lib/aws-route53';
import { LoadBalancerTarget } from 'aws-cdk-lib/aws-route53-targets';
import { AutoScalingGroup } from 'aws-cdk-lib/aws-autoscaling';
import * as elb from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as s3 from 'aws-cdk-lib/aws-s3';

export interface LoadBalancerProps {
    removalPolicy: RemovalPolicy;
    autoDelete: boolean;
    vpc: Vpc;
    subnets: ISubnet[];
    securityGroup: SecurityGroup;
    domainPrefix: string;
    rootDomain: string;
    certificate: Certificate;
    hostedZone: IHostedZone;
    autoScalingGroup: AutoScalingGroup;
}

export class LoadBalancerConstruct extends Construct {
    public readonly loadBalancer: elb.ApplicationLoadBalancer;

    /**
     * Creates a cross-account role allowing the AWS Prototyping Team
     * to access customer accounts by assuming the role.
     * @param scope the construct scope.
     * @param id the identifier given the construct.np
     * @param props the construct configuration.
     */
    constructor(scope: Construct, id: string, props: LoadBalancerProps) {
        super(scope, id);

        // create new Application Load Balancer
        this.loadBalancer = new elb.ApplicationLoadBalancer(this, 'LoadBalancer', {
            vpc: props.vpc,
            vpcSubnets: { subnets: props.subnets },
            securityGroup: props.securityGroup,
            internetFacing: true,
            http2Enabled: true,
        });

        // removal policy -- change in config
        this.loadBalancer.applyRemovalPolicy(props.removalPolicy ?? RemovalPolicy.DESTROY);

        // access logs for load balancer
        this.loadBalancer.logAccessLogs(
            new s3.Bucket(this, 'LoadBalancerAccessLogsBucket', {
                encryption: s3.BucketEncryption.S3_MANAGED,
                // removalPolicy: props.removalPolicy,
                // autoDeleteObjects: props.autoDelete,
                enforceSSL: true,
                publicReadAccess: false,
                blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
                objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED
            }),
            'logs/lb'
        );

        // add ALB as target for Route 53 Hosted Zone
        new ARecord(this, 'LoadBalancerAliasRecord', {
            zone: props.hostedZone,
            recordName: `${props.domainPrefix}.${props.rootDomain}`,
            ttl: Duration.seconds(300),
            target: RecordTarget.fromAlias(new LoadBalancerTarget(this.loadBalancer)),
        });

        // --------------------------------------------------------------------
        // Target Groups
        // --------------------------------------------------------------------
        const targetGroup = new elb.ApplicationTargetGroup(this, 'TargetGroup', {
            protocol: elb.ApplicationProtocol.HTTP,
            protocolVersion: elb.ApplicationProtocolVersion.HTTP1,
            targetType: elb.TargetType.INSTANCE,
            vpc: props.vpc,
            targets: [props.autoScalingGroup],
            healthCheck: {
                port: '80',
                path: '/healthcheck',
            },
        });

        // --------------------------------------------------------------------
        // LISTENERS
        // --------------------------------------------------------------------
        const httpListener = this.loadBalancer.addRedirect({
            sourceProtocol: elb.ApplicationProtocol.HTTP,
            sourcePort: 80,
            targetProtocol: elb.ApplicationProtocol.HTTPS,
            targetPort: 443,
        });

        const sslListener = this.loadBalancer.addListener('SSLListener', {
            protocol: elb.ApplicationProtocol.HTTPS,
            port: 443,
            sslPolicy: elb.SslPolicy.TLS12,
            certificates: [props.certificate],
            defaultTargetGroups: [targetGroup],
        });
    }
}
