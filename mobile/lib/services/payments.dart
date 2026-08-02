import '../core/api_client.dart';
import '../models/models.dart';

class PaymentService {
  PaymentService(this._api);
  final ApiClient _api;

  Future<List<Plan>> plans() async {
    final res = await _api.request('/plans', auth: false);
    return ((res.data as List?) ?? []).map((p) => Plan.fromJson(p)).toList();
  }

  Future<List<PayMethod>> methods() async {
    final res = await _api.request('/payments/methods');
    return ((res.data['methods'] as List?) ?? []).map((m) => PayMethod.fromJson(m)).toList();
  }

  /// Start a subscription (or title purchase) checkout.
  Future<CheckoutResult> checkout({
    required String purpose, // 'subscription' | 'title'
    int? planId,
    String? titleId,
    required String method, // 'card' | 'mobile_money'
    String? payerPhone,
  }) async {
    final res = await _api.request('/payments/checkout', method: 'POST', data: {
      'purpose': purpose,
      if (planId != null) 'planId': planId,
      if (titleId != null) 'titleId': titleId,
      'method': method,
      if (payerPhone != null && payerPhone.isNotEmpty) 'payerPhone': payerPhone,
    });
    return CheckoutResult.fromJson(res.data);
  }

  /// Poll payment status: 'pending' | 'successful' | 'failed'.
  Future<String> status(String paymentId) async {
    final res = await _api.request('/payments/$paymentId');
    return (res.data['status'] ?? 'pending').toString();
  }
}
