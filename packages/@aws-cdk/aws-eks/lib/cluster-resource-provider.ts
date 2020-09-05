import * as path from 'path';
import * as ec2 from '@aws-cdk/aws-ec2';
import * as iam from '@aws-cdk/aws-iam';
import * as lambda from '@aws-cdk/aws-lambda';
import { Construct, Duration, NestedStack, Stack } from '@aws-cdk/core';
import * as cr from '@aws-cdk/custom-resources';

const HANDLER_DIR = path.join(__dirname, 'cluster-resource-handler');
const HANDLER_RUNTIME = lambda.Runtime.NODEJS_12_X;

export interface ClusterResourceProviderProps {
  /**
   * The IAM role to assume in order to interact with the cluster.
   */
  readonly adminRole: iam.IRole;

  /**
   * The VPC the cluster will be placed in.
   */
  readonly vpc: ec2.IVpc;

  /**
   * The private subnets the cluster would connect to. If they exist, all the provider functions
   * will also be placed in the VPC using these subnets, if not, they will not be placed in the VPC.
   */
  readonly privateSubnets?: ec2.ISubnet[];

}

/**
 * A custom resource provider that handles cluster operations. It serves
 * multiple custom resources such as the cluster resource and the fargate
 * resource.
 *
 * @internal
 */
export class ClusterResourceProvider extends NestedStack {

  public static getOrCreate(scope: Construct, props: ClusterResourceProviderProps) {
    const stack = Stack.of(scope);
    const uid = '@aws-cdk/aws-eks.ClusterResourceProvider';
    return stack.node.tryFindChild(uid) as ClusterResourceProvider ?? new ClusterResourceProvider(stack, uid, props);
  }

  /**
   * The custom resource provider to use for custom resources.
   */
  public readonly provider: cr.Provider;

  private constructor(scope: Construct, id: string, props: ClusterResourceProviderProps) {
    super(scope, id);

    const onEvent = new lambda.Function(this, 'OnEventHandler', {
      code: lambda.Code.fromAsset(HANDLER_DIR),
      description: 'onEvent handler for EKS cluster resource provider',
      runtime: HANDLER_RUNTIME,
      handler: 'index.onEvent',
      vpc: props.vpc,
      vpcSubnets: { subnets: props.privateSubnets },
      timeout: Duration.minutes(1),
    });

    const isComplete = new lambda.Function(this, 'IsCompleteHandler', {
      code: lambda.Code.fromAsset(HANDLER_DIR),
      description: 'isComplete handler for EKS cluster resource provider',
      runtime: HANDLER_RUNTIME,
      handler: 'index.isComplete',
      vpc: props.vpc,
      vpcSubnets: { subnets: props.privateSubnets },
      timeout: Duration.minutes(1),
    });

    this.provider = new cr.Provider(this, 'Provider', {
      onEventHandler: onEvent,
      vpc: props.vpc,
      vpcSubnets: { subnets: props.privateSubnets },
      isCompleteHandler: isComplete,
      totalTimeout: Duration.hours(1),
      queryInterval: Duration.minutes(1),
    });

    props.adminRole.grant(onEvent.role!, 'sts:AssumeRole');
    props.adminRole.grant(isComplete.role!, 'sts:AssumeRole');
  }

  /**
   * The custom resource service token for this provider.
   */
  public get serviceToken() { return this.provider.serviceToken; }
}