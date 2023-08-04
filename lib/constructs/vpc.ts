import { CfnOutput, RemovalPolicy, Stack } from 'aws-cdk-lib';
import { Construct } from 'constructs';
import { LogGroup, RetentionDays } from 'aws-cdk-lib/aws-logs';
import { cleanEnv, str } from 'envalid';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as dotenv from 'dotenv';
import { NagSuppressions } from 'cdk-nag';


dotenv.config();
const env = cleanEnv(process.env, {
	ALLOWED_CIDR_RANGE_01: str({ default: '' }),
	ROOT_DOMAIN: str({ default: '' }),
});

export interface VpcResourcesProps {
	removalPolicy: RemovalPolicy;
}

export class VpcResources extends Construct {
	public readonly vpc: ec2.Vpc;
	public readonly securityGroups: {
		loadBalancer: ec2.SecurityGroup;
		workstation: ec2.SecurityGroup;
		reverseProxy: ec2.SecurityGroup;
		nucleus: ec2.SecurityGroup;
	};
	public readonly subnets: {
		loadBalancer: ec2.ISubnet[];
		workstation: ec2.ISubnet[];
		reverseProxy: ec2.ISubnet[];
		nucleus: ec2.ISubnet[];
	};

	/**
	 * Creates a cross-account role allowing the AWS Prototyping Team
	 * to access customer accounts by assuming the role.
	 * @param scope the construct scope.
	 * @param id the identifier given the construct.np
	 * @param props the construct configuration.
	 */
	constructor(scope: Construct, id: string, props: VpcResourcesProps) {
		super(scope, id);

		const stackName = Stack.of(this).stackName;

		// ------------------------------------------------------------------------
		// Subnets
		// ------------------------------------------------------------------------
		const natGatewaySubnet: ec2.SubnetConfiguration = {
			name: 'NatGatewayPublicSubnet',
			subnetType: ec2.SubnetType.PUBLIC,
			cidrMask: 28, // 16
		};

		const loadBalancerSubnetConfig: ec2.SubnetConfiguration = {
			name: 'LoadBalancerPrivateSubnet',
			subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
			cidrMask: 22, // 1024
		};

		const workstationSubnetConfig: ec2.SubnetConfiguration = {
			name: 'WorkstationPublicSubnet',
			subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
			cidrMask: 22, // 1024
		};

		const reverseProxySubnetConfig: ec2.SubnetConfiguration = {
			name: 'ReverseProxyPublicSubnet',
			subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
			cidrMask: 22, // 1024
		};

		const nucleusSubnetConfig: ec2.SubnetConfiguration = {
			name: 'NucleusPrivateSubnet',
			subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
			cidrMask: 22, // 1024
		};

		// ------------------------------------------------------------------------
		// VPC
		// ------------------------------------------------------------------------
		const cloudWatchLogs = new LogGroup(this, 'CloudWatchVPCLogs', {
			retention: RetentionDays.ONE_WEEK,
			removalPolicy: props.removalPolicy,
		});

		// Elastic IP for NatGateway
		const eip = new ec2.CfnEIP(this, 'NATGatewayEIP', {
			domain: 'vpc',
		});

		const natGatewayProvider = ec2.NatProvider.gateway({
			eipAllocationIds: [eip.attrAllocationId],
		});

		const cidrRange: string = '10.0.0.0/16'; // 65,536

		this.vpc = new ec2.Vpc(this, 'OmniVpc', {
			ipAddresses: ec2.IpAddresses.cidr(cidrRange),
			natGateways: 1,
			subnetConfiguration: [
				natGatewaySubnet,
				loadBalancerSubnetConfig,
				workstationSubnetConfig,
				reverseProxySubnetConfig,
				nucleusSubnetConfig,
			],
			natGatewayProvider: natGatewayProvider,
			flowLogs: {
				'vpc-logs': {
					destination: ec2.FlowLogDestination.toCloudWatchLogs(cloudWatchLogs),
					trafficType: ec2.FlowLogTrafficType.ALL,
				},
			},
			createInternetGateway: true,
		});

		this.vpc.selectSubnets({
			subnetGroupName: loadBalancerSubnetConfig.name,
		}).subnets.forEach((subnet: ec2.ISubnet) => {
			(subnet as ec2.Subnet).addRoute('AllowedCidrRoute', {
				destinationCidrBlock: env.ALLOWED_CIDR_RANGE_01,
				routerType: ec2.RouterType.GATEWAY,
				routerId: this.vpc.internetGatewayId!,
				enablesInternetConnectivity: true,
			});
		});

		this.subnets = {
			loadBalancer: this.vpc.selectSubnets({
				subnetGroupName: loadBalancerSubnetConfig.name,
			}).subnets,
			workstation: this.vpc.selectSubnets({
				subnetGroupName: workstationSubnetConfig.name,
			}).subnets,
			reverseProxy: this.vpc.selectSubnets({
				subnetGroupName: reverseProxySubnetConfig.name,
			}).subnets,
			nucleus: this.vpc.selectSubnets({
				subnetGroupName: nucleusSubnetConfig.name,
			}).subnets,
		};

		// ------------------------------------------------------------------------
		// Security Groups
		// ------------------------------------------------------------------------
		const natGatewaySG = new ec2.SecurityGroup(this, 'NatGatewaySG', {
			securityGroupName: `${stackName}-nat-gateway-sg`,
			description: 'NAT Gateway Security Group',
			vpc: this.vpc,
			allowAllOutbound: true,
		});

		const loadBalancerSG = new ec2.SecurityGroup(this, 'LoadBalancerSG', {
			securityGroupName: `${stackName}-load-balancer-sg`,
			description: 'Load Balancer Security Group',
			vpc: this.vpc,
			allowAllOutbound: true,
		});

		const workstationSG = new ec2.SecurityGroup(this, 'WorkstationSG', {
			securityGroupName: `${stackName}-workstation-sg`,
			description: 'Workstation Security Group',
			vpc: this.vpc,
			allowAllOutbound: true,
		});

		const reverseProxySG = new ec2.SecurityGroup(this, 'ReverseProxySG', {
			securityGroupName: `${stackName}-reverse-proxy-sg`,
			description: 'Reverse Proxy Security Group',
			vpc: this.vpc,
			allowAllOutbound: true,
		});

		const nucleusSG = new ec2.SecurityGroup(this, 'NucleusSG', {
			securityGroupName: `${stackName}-nucleus-sg`,
			description: 'Nucleus Server Security Group',
			vpc: this.vpc,
			allowAllOutbound: true,
		});

		const ssmEndpointSG = new ec2.SecurityGroup(this, 'SSMEndpointSG', {
			vpc: this.vpc,
			allowAllOutbound: true,
			description: 'SSM Endpoint Security Group',
		});

		// loadBalancerSG rules
		loadBalancerSG.addIngressRule(ec2.Peer.ipv4(env.ALLOWED_CIDR_RANGE_01), ec2.Port.tcp(80), 'HTTP access');
		loadBalancerSG.addIngressRule(ec2.Peer.ipv4(env.ALLOWED_CIDR_RANGE_01), ec2.Port.tcp(443), 'HTTPS access');
		loadBalancerSG.addIngressRule(ec2.Peer.ipv4(cidrRange), ec2.Port.tcp(443), 'VPC Access');
		loadBalancerSG.addIngressRule(ec2.Peer.securityGroupId(workstationSG.securityGroupId), ec2.Port.tcp(80), 'Workstation access');
		loadBalancerSG.addIngressRule(ec2.Peer.securityGroupId(workstationSG.securityGroupId), ec2.Port.tcp(443), 'Workstation access');
		loadBalancerSG.addIngressRule(ec2.Peer.securityGroupId(natGatewaySG.securityGroupId), ec2.Port.tcp(443), 'NAT access');

		reverseProxySG.addIngressRule(ec2.Peer.ipv4(cidrRange), ec2.Port.tcp(443), 'VPC Access');
		reverseProxySG.addIngressRule(ec2.Peer.securityGroupId(natGatewaySG.securityGroupId), ec2.Port.tcp(443), 'NAT access');

		// nucleusSG rules
		const nucleusRules = [
			{ port: 80, desc: 'Nucleus Web' },
			{ port: 8080, desc: 'Nucleus Web3' },
			{ port: 3009, desc: 'Nucleus API' },
			{ port: 3010, desc: 'Nucleus Metrics' },
			{ port: 3019, desc: 'Nucleus API 2' },
			{ port: 3030, desc: 'Nucleus LFT' },
			{ port: 3333, desc: 'Nucleus Discovery' },
			{ port: 3100, desc: 'Nucleus Auth' },
			{ port: 3180, desc: 'Nucleus Login' },
			{ port: 3020, desc: 'Nucleus Tagging3' },
			{ port: 3400, desc: 'Nucleus Search3' },
		];

		nucleusRules.forEach((rule) => {
			nucleusSG.addIngressRule(
				ec2.Peer.securityGroupId(reverseProxySG.securityGroupId),
				ec2.Port.tcp(rule.port),
				rule.desc
			);
		});

		nucleusSG.addIngressRule(ec2.Peer.ipv4(cidrRange), ec2.Port.tcp(443), 'VPC access');
		nucleusSG.addIngressRule(ec2.Peer.securityGroupId(natGatewaySG.securityGroupId), ec2.Port.tcp(443), 'NAT access');

		// workstationSG rules
		workstationSG.addIngressRule(ec2.Peer.ipv4(env.ALLOWED_CIDR_RANGE_01), ec2.Port.tcp(443), 'HTTPS access');
		workstationSG.addIngressRule(ec2.Peer.ipv4(env.ALLOWED_CIDR_RANGE_01), ec2.Port.udp(8443), 'UDP access');
		workstationSG.addIngressRule(ec2.Peer.ipv4(cidrRange), ec2.Port.tcp(443), 'VPC access');
		workstationSG.addIngressRule(ec2.Peer.securityGroupId(natGatewaySG.securityGroupId), ec2.Port.tcp(443), 'NAT access');

		this.securityGroups = {
			loadBalancer: loadBalancerSG,
			workstation: workstationSG,
			reverseProxy: reverseProxySG,
			nucleus: nucleusSG,
		};

		// ssm endpoint rules
		ssmEndpointSG.addIngressRule(ec2.Peer.ipv4(cidrRange), ec2.Port.tcp(443), 'HTTPS Access');

		// ------------------------------------------------------------------------
		// Service Endpoints
		// ------------------------------------------------------------------------
		const s3Endpoint: ec2.GatewayVpcEndpoint = this.vpc.addGatewayEndpoint('S3GatewayEndpoint', {
			service: ec2.GatewayVpcEndpointAwsService.S3,
			subnets: [{ subnets: this.subnets.nucleus }, { subnets: this.subnets.reverseProxy }],
		});

		const ssmEndpoint: ec2.InterfaceVpcEndpoint = this.vpc.addInterfaceEndpoint(
			'ssm-interface-endpoint',
			{
				service: ec2.InterfaceVpcEndpointAwsService.SSM,
				subnets: { subnets: this.subnets.nucleus },
				securityGroups: [this.securityGroups.nucleus],
				open: false,
			}
		);

		// ------------------------------------------------------------------------
		// Outputs
		// ------------------------------------------------------------------------
		new CfnOutput(this, 'VpcID', {
			value: this.vpc.vpcId,
		});

		// ------------------------------------
		// CDK_NAG (security scan) suppressions
		// ------------------------------------
		NagSuppressions.addResourceSuppressions(
			reverseProxySG,
			[
				{
					id: 'AwsSolutions-EC23',
					reason:
						'Security Group inbound access can be modified in the app configuration. For production, this will be set to the IP range for the local network.',
				},
			],
			true
		);

		NagSuppressions.addResourceSuppressions(
			nucleusSG,
			[
				{
					id: 'AwsSolutions-EC23',
					reason:
						'Security Group inbound access can be modified in the app configuration. For production, this will be set to the IP range for the local network.',
				},
			],
			true
		);

		NagSuppressions.addResourceSuppressions(
			loadBalancerSG,
			[
				{
					id: 'AwsSolutions-EC23',
					reason:
						'Security Group inbound access can be modified in the app configuration. For production, this will be set to the IP range for the local network.',
				},
			],
			true
		);
	}
}
