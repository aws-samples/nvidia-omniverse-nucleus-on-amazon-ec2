import { CfnOutput, RemovalPolicy } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { cleanEnv, str, bool } from 'envalid';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as route53 from 'aws-cdk-lib/aws-route53';
import * as acm from 'aws-cdk-lib/aws-certificatemanager';
import * as dotenv from 'dotenv';

dotenv.config();
const env = cleanEnv(process.env, {
	ALLOWED_CIDR_RANGE_01: str({ default: '' }),
	ALLOWED_CIDR_RANGE_02: str({ default: '' }),
	ALLOWED_CIDR_RANGE_03: str({ default: '' }),
	DEV_MODE: bool({ default: false }),
	ROOT_DOMAIN: str({ default: '' }),
});

export type ConstructProps = {};

export class VpcResources extends Construct {
	public readonly vpc: ec2.Vpc;
	public readonly s3GatewayEndpoint: ec2.GatewayVpcEndpoint;
	public readonly publicSubnet: ec2.SubnetSelection;
	public readonly privateSubnet: ec2.SubnetSelection;
	public readonly workstationSG: ec2.SecurityGroup;
	public readonly reverseProxySG: ec2.SecurityGroup;
	public readonly nucluesSG: ec2.SecurityGroup;
	public readonly hostedZone: route53.IHostedZone;
	public readonly certificate: acm.Certificate;

	/**
	 * Creates a cross-account role allowing the AWS Prototyping Team
	 * to access customer accounts by assuming the role.
	 * @param scope the construct scope.
	 * @param id the identifier given the construct.np
	 * @param props the construct configuration.
	 */
	constructor(scope: Construct, id: string, props: ConstructProps) {
		super(scope, id);

		var removalPolicy = RemovalPolicy.RETAIN;
		if (env.DEV_MODE == true) {
			removalPolicy = RemovalPolicy.DESTROY;
		}

		// ------------------------------------------------------------------------
		// Subnets
		// ------------------------------------------------------------------------
		const publicSubnetConfig: ec2.SubnetConfiguration = {
			name: 'public-subnet-nat-gateway',
			subnetType: ec2.SubnetType.PUBLIC,
			cidrMask: 24,
		};

		const privateSubnetConfig: ec2.SubnetConfiguration = {
			name: 'private-subnet',
			subnetType: ec2.SubnetType.PRIVATE_WITH_NAT,
			cidrMask: 24,
		};

		this.privateSubnet = {
			subnetGroupName: publicSubnetConfig.name,
		};

		this.publicSubnet = {
			subnetGroupName: privateSubnetConfig.name,
		};

		// ------------------------------------------------------------------------
		// VPC
		// ------------------------------------------------------------------------
		const cloudWatchLogs = new LogGroup(this, 'cw-vpc-log', {
			retention: RetentionDays.ONE_WEEK,
			removalPolicy: RemovalPolicy.DESTROY,
		});

		// Elastic IP for NatGateway
		const eip = new ec2.CfnEIP(this, 'nat-gateway-eip', {
			domain: 'vpc',
		});

		this.vpc = new ec2.Vpc(this, 'OmniVpc', {
			cidr: '10.0.0.0/20', // 4,096 IPs in Range
			natGateways: 1,
			subnetConfiguration: [publicSubnetConfig, privateSubnetConfig],
			natGatewayProvider: ec2.NatProvider.gateway({
				eipAllocationIds: [eip.attrAllocationId],
			}),
			flowLogs: {
				'vpc-logs': {
					destination: ec2.FlowLogDestination.toCloudWatchLogs(cloudWatchLogs),
					trafficType: ec2.FlowLogTrafficType.ALL,
				},
			},
		});

		// ------------------------------------------------------------------------
		// Security Groups
		// ------------------------------------------------------------------------
		this.workstationSG = new ec2.SecurityGroup(this, 'WorkstationSG', {
			vpc: this.vpc,
			allowAllOutbound: true,
			description: 'Workstation Security Group',
		});
		this.reverseProxySG = new ec2.SecurityGroup(this, 'ReverseProxySG', {
			vpc: this.vpc,
			allowAllOutbound: true,
			description: 'Reverse Proxy Security Group',
		});
		this.nucluesSG = new ec2.SecurityGroup(this, 'NucluesSG', {
			vpc: this.vpc,
			allowAllOutbound: true,
			description: 'Nuclues Server Security Group',
		});

		this.nucluesSG.addIngressRule(
			ec2.Peer.securityGroupId(this.reverseProxySG.securityGroupId),
			ec2.Port.tcpRange(0, 65535),
			'FIXME, update to required Nucleus ports'
		);

		this.reverseProxySG.addIngressRule(
			ec2.Peer.securityGroupId(this.workstationSG.securityGroupId),
			ec2.Port.tcp(8080),
			'HTTP access from workstations'
		);

		this.reverseProxySG.addIngressRule(
			ec2.Peer.securityGroupId(this.workstationSG.securityGroupId),
			ec2.Port.tcp(80),
			'HTTP access from workstations'
		);
		this.reverseProxySG.addIngressRule(
			ec2.Peer.securityGroupId(this.workstationSG.securityGroupId),
			ec2.Port.tcp(443),
			'HTTPS access from workstations'
		);
		this.reverseProxySG.addIngressRule(
			ec2.Peer.securityGroupId(this.workstationSG.securityGroupId),
			ec2.Port.tcpRange(0, 65535),
			'FIXME, update to required Nucleus ports'
		);

		var allowed_cidr_ranges: string[] = [];
		if (env.ALLOWED_CIDR_RANGE_01 != '') {
			allowed_cidr_ranges.push(env.ALLOWED_CIDR_RANGE_01);
		}
		if (env.ALLOWED_CIDR_RANGE_02 != '') {
			allowed_cidr_ranges.push(env.ALLOWED_CIDR_RANGE_02);
		}

		for (var i = 0; i < allowed_cidr_ranges.length; i++) {
			this.workstationSG.addIngressRule(
				ec2.Peer.ipv4(allowed_cidr_ranges[i]),
				ec2.Port.tcp(8443),
				'DCV Access'
			);
			this.workstationSG.addIngressRule(
				ec2.Peer.ipv4(allowed_cidr_ranges[i]),
				ec2.Port.tcp(443),
				'HTTPS Access'
			);
			this.workstationSG.addIngressRule(
				ec2.Peer.ipv4(allowed_cidr_ranges[i]),
				ec2.Port.tcp(8080),
				'HTTP Access'
			);
			this.workstationSG.addIngressRule(
				ec2.Peer.ipv4(allowed_cidr_ranges[i]),
				ec2.Port.tcp(80),
				'HTTP Access'
			);
			this.reverseProxySG.addIngressRule(
				ec2.Peer.ipv4(allowed_cidr_ranges[i]),
				ec2.Port.tcp(80),
				'HTTPS access'
			);
			this.reverseProxySG.addIngressRule(
				ec2.Peer.ipv4(allowed_cidr_ranges[i]),
				ec2.Port.tcp(8080),
				'HTTP access'
			);
			this.reverseProxySG.addIngressRule(
				ec2.Peer.ipv4(allowed_cidr_ranges[i]),
				ec2.Port.tcp(443),
				'HTTPS access'
			);
			this.reverseProxySG.addIngressRule(
				ec2.Peer.ipv4(allowed_cidr_ranges[i]),
				ec2.Port.tcpRange(0, 65535),
				'FIXME, update to required Nucleus ports'
			);
		}

		// Domain and Certs
		this.hostedZone = route53.HostedZone.fromLookup(this, 'PublicHostedZone', {
			domainName: env.ROOT_DOMAIN,
		});
		this.certificate = new acm.Certificate(this, 'PublicCertificate', {
			domainName: env.ROOT_DOMAIN,
			subjectAlternativeNames: [`*.${env.ROOT_DOMAIN}`],
			validation: acm.CertificateValidation.fromDns(this.hostedZone),
		});

		// ------------------------------------------------------------------------
		// S3 Gateway Endpoint
		// ------------------------------------------------------------------------
		const s3Endpoint: ec2.GatewayVpcEndpoint = this.vpc.addGatewayEndpoint('s3-gateway-endpoint', {
			service: ec2.GatewayVpcEndpointAwsService.S3,
			subnets: [{ subnets: this.vpc.privateSubnets }],
		});

		this.s3GatewayEndpoint = s3Endpoint;

		// ------------------------------------------------------------------------
		// Outputs
		// ------------------------------------------------------------------------
		new CfnOutput(this, 'VpcID', {
			value: this.vpc.vpcId,
		});
	}
}
