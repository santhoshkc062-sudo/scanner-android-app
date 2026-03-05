import { Component, OnInit, PLATFORM_ID, Inject, NgZone, ChangeDetectorRef } from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { BarcodeScanner, LensFacing } from '@capacitor-mlkit/barcode-scanning';
import { isPlatformBrowser } from '@angular/common';
import { DataTransfer } from './services/data-transfer';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, FormsModule],
  templateUrl: './app.html',
  styleUrls: ['./app.css'],
})
export class AppComponent implements OnInit {
  ipAddress: string = '';
  isIpSet: boolean = false;
  scanResult: string = '';
  errormessage: string = '';
  response: any;

  constructor(private zone: NgZone, 
    @Inject(PLATFORM_ID) private platformId: Object,
    private cd: ChangeDetectorRef,
    private dataTransfer: DataTransfer
  ) { }

  ngOnInit() {
    if (isPlatformBrowser(this.platformId)) {
      const savedIp = localStorage.getItem('serverIp');
      const scanResult = localStorage.getItem('scanResult');
      const storedScan = localStorage.getItem('scanData');
      if (savedIp) {
        this.ipAddress = savedIp;
        this.isIpSet = true;
      }

      if(storedScan){
        this.response = JSON.parse(storedScan);
      }
    }

    console.log('response from server:', this.response);
  }

  setIp() {
    if (this.ipAddress.trim() !== '') {
      if (isPlatformBrowser(this.platformId)) {
        localStorage.setItem('serverIp', this.ipAddress);
      }
      this.isIpSet = true;
    } else {
      alert('Please enter IP Address');
    }
  }

async scanQR() {
  try {

    const permission = await BarcodeScanner.requestPermissions();
    if (permission.camera !== 'granted') {
      alert('Camera permission denied');
      return;
    }

      const { available } = await BarcodeScanner.isGoogleBarcodeScannerModuleAvailable();

      if (!available) {
        alert('Scanner module missing. Downloading now... please wait 10 seconds and try again.');
        await BarcodeScanner.installGoogleBarcodeScannerModule();
        return;
      }

      const result = await BarcodeScanner.scan();

    if (result.barcodes.length > 0) {

      const value = result.barcodes[0].rawValue!;

      const paylod = { barcode : value };

      if(!this.response){
              this.dataTransfer.sendData(paylod).subscribe(
        (response: any) => {
          this.response = response;
          this.response = {
            customerName: response.customerName,
            partName: response.partName,
            partNumber: response.partNumber,
            id : response.id
          };

          if (isPlatformBrowser(this.platformId)) {
            localStorage.setItem("scanData", JSON.stringify(response));
          }

          if (response.ScanningCompleted === true) {

  if (isPlatformBrowser(this.platformId)) {
    localStorage.removeItem("scanData");
  }

  this.response = null;   

}

    this.zone.run(() => {
      this.scanResult = response.message || JSON.stringify(response);
      this.cd.detectChanges();
    });

  },

  (error) => {

  console.error('Server error:', error);

  this.zone.run(() => {

    if (error.error && error.error.message) {
      this.errormessage = error.error.message;
    } 
    else if (error.error && typeof error.error === 'string') {
      this.errormessage = error.error;
    }
    else {
      this.errormessage = error.message || 'Server Error';
    }

    this.scanResult = 'Failed';
    this.cd.detectChanges();
  });

}
);

      }

      else{
        const dataSent = {
          barcode: value,
          id : this.response.id
        }
        console.log('Data to send:', dataSent);
        this.dataTransfer.sendData(dataSent).subscribe(
          (response: any) => {
            this.response = response;
            this.response = {
              customerName: response.customerName,
              partName: response.partName,
              partNumber: response.partNumber,
              id : response.id
            };
            if (isPlatformBrowser(this.platformId)) {
              localStorage.setItem("scanData", JSON.stringify(response));
            }
            if (response.ScanningCompleted === true) {
              localStorage.removeItem("scanData");
            }
            this.zone.run(() => {
              this.scanResult = response.message || JSON.stringify(response);
              this.cd.detectChanges();
            });
          },
          (error) => {
            console.error('Server error:', error);
            this.zone.run(() => {
              if (error.error && error.error.message) {
                this.errormessage = error.error.message;
              }
              else if (error.error && typeof error.error === 'string') {
                this.errormessage = error.error;
              }
              else {
                this.errormessage = error.message || 'Server Error';
              }
              this.scanResult = 'Failed';
              this.cd.detectChanges();
            });
          }
        );
      }

  



      await BarcodeScanner.stopScan();
    }
  } catch (error) {
    console.error('Scan Error:', error);
    alert('Scanning failed. Make sure Google Play Services is updated.');
  }
}


  resetIp() {
    this.isIpSet = false;
    this.scanResult = '';
  }

  rescan() {
  this.scanResult = '';
  this.scanQR();
}

datasent(){

  const payload = {
     barcode: "P4949683;S2001;D26001;V059428"
  }
  console.log('Payload to send:', this.response);

  if(!this.response){
      this.dataTransfer.sendData(payload).subscribe(
   (response: any) => {

  this.response = response;

  this.response = {
    customerName: response.customerName,
    partName: response.partName,
    partNumber: response.partNumber,
  };

  if (isPlatformBrowser(this.platformId)) {
    localStorage.setItem("scanData", JSON.stringify(response));
  }

  if (response.ScanningCompleted === true) {
    localStorage.removeItem("scanData");
  }

  this.zone.run(() => {
    this.scanResult = response.message;
    this.cd.detectChanges();
  });

},
    (error) => {
      this.errormessage = error.message || 'Unknown error';
      console.error('Error clearing data on server:', error.message || error);
      alert('Failed to clear data on server');
    }
  );
  }
  else{

    const dataSent = {
      barcode: "P4949683;S2003;D26001;V059428",
      id: this.response.id
    }

    console.log('Data to send:', dataSent);

    this.dataTransfer.sendData(dataSent).subscribe(
      (response: any) => {
        this.response = response;
        this.response = {
          customerName: response.customerName,
          partName: response.partName,
          partNumber: response.partNumber,
        };
        if (isPlatformBrowser(this.platformId)) {
          localStorage.setItem("scanData", JSON.stringify(response));
        }
        if (response.ScanningCompleted === true) {
          localStorage.removeItem("scanData");
          this.response = null;
        }
        this.zone.run(() => {
          this.scanResult = response.message;
          this.cd.detectChanges();
        });
      },
      (error) => {
        this.errormessage = error.message || 'Unknown error';
        console.error('Error clearing data on server:', error.message || error);
        alert('Failed to clear data on server');
      }
    );
    

  }

}
}
