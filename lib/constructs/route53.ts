import { Construct } from 'constructs';
import { HostedZone, IHostedZone } from 'aws-cdk-lib/aws-route53';
import { Certificate, CertificateValidation } from 'aws-cdk-lib/aws-certificatemanager';

export interface Route53Props {
    rootDomain: string;
}

export class Route53Resources extends Construct {
    public readonly hostedZone: IHostedZone;
    public readonly certificate: Certificate;

    constructor(scope: Construct, id: string, props: Route53Props) {
        super(scope, id);

        this.hostedZone = HostedZone.fromLookup(this, 'PublicHostedZone', {
            domainName: props.rootDomain,
        });

        this.certificate = new Certificate(this, 'PublicCertificate', {
            domainName: props.rootDomain,
            subjectAlternativeNames: [`*.${props.rootDomain}`],
            validation: CertificateValidation.fromDns(this.hostedZone),
        });
    }
}
