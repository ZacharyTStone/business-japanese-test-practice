package app.businessjapanesedrill.googlesignin

import android.util.Base64
import androidx.credentials.ClearCredentialStateRequest
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.ClearCredentialException
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.android.libraries.identity.googleid.GoogleIdTokenParsingException
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.exception.Exceptions
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.security.SecureRandom

/**
 * Sign in with Google through Credential Manager: Google's own account sheet,
 * no browser and no redirect, so the app claims no custom scheme. The answer
 * is an ID token for the Web client id the app passes (the Worker checks it
 * as its own audience) with a fresh nonce in it; the Worker turns it into a
 * session. Nothing about the account is kept here.
 */
class GoogleSignInModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("GoogleSignIn")

    AsyncFunction("signIn") Coroutine { serverClientId: String ->
      val activity = appContext.currentActivity ?: throw Exceptions.MissingActivity()
      val nonce = newNonce()
      // The button's flow: every Google account on the phone, and "add
      // another", rather than only the ones that signed in before.
      val option = GetSignInWithGoogleOption.Builder(serverClientId)
        .setNonce(nonce)
        .build()
      val request = GetCredentialRequest.Builder()
        .addCredentialOption(option)
        .build()
      val credential = try {
        CredentialManager.create(activity).getCredential(activity, request).credential
      } catch (e: GetCredentialCancellationException) {
        throw SignInCancelledException(e)
      } catch (e: NoCredentialException) {
        throw NoGoogleAccountException(e)
      } catch (e: GetCredentialException) {
        throw SignInFailedException(e)
      }
      if (credential !is CustomCredential ||
        credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
      ) {
        throw SignInFailedException(null)
      }
      val google = try {
        GoogleIdTokenCredential.createFrom(credential.data)
      } catch (e: GoogleIdTokenParsingException) {
        throw SignInFailedException(e)
      }
      mapOf("idToken" to google.idToken, "nonce" to nonce)
    }

    AsyncFunction("signOut") Coroutine { ->
      val context = appContext.reactContext
      if (context != null) {
        try {
          CredentialManager.create(context).clearCredentialState(ClearCredentialStateRequest())
        } catch (e: ClearCredentialException) {
          // Nothing was chosen, or nothing is left to forget.
        }
      }
    }
  }

  private fun newNonce(): String {
    val bytes = ByteArray(32)
    SecureRandom().nextBytes(bytes)
    return Base64.encodeToString(bytes, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
  }
}

private class SignInCancelledException(cause: Throwable?) :
  CodedException("ERR_SIGN_IN_CANCELLED", "The sign-in was cancelled", cause)

private class NoGoogleAccountException(cause: Throwable?) :
  CodedException("ERR_NO_GOOGLE_ACCOUNT", "No Google account on this device", cause)

private class SignInFailedException(cause: Throwable?) :
  CodedException("ERR_SIGN_IN_FAILED", "Google sign-in failed", cause)
